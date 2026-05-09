"""
Client portal API — authentication and tenant-scoped ticket access for portal users.
"""
import hashlib
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import PortalUser, TicketCustomer, Ticket, TicketComment
from ..routers.sso import issue_portal_token
from ..routers.ticket_integration import _get_ticketing_mode, _dispatch_list, _dispatch_get, _dispatch_create, _dispatch_comment

router = APIRouter(prefix="/api/portal", tags=["portal"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def _require_portal_user(request: Request) -> dict:
    u = getattr(request.state, "user", None)
    if not u or not u.get("customer_id"):
        raise HTTPException(403, "Portal users only")
    return u

def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}

def _ticket_dict(t: Ticket, comments: list | None = None) -> dict:
    d = _clean(t.__dict__)
    try:
        d["tags"] = json.loads(t.tags or "[]")
    except Exception:
        d["tags"] = []
    if comments is not None:
        d["comments"] = [_clean(c.__dict__) for c in comments]
    return d

# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    email:    str
    password: str

@router.post("/auth/login")
async def portal_login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    u = (await db.execute(
        select(PortalUser).where(PortalUser.email == body.email.lower())
    )).scalar_one_or_none()
    if not u or not u.is_active:
        raise HTTPException(401, "Invalid email or password")
    if u.password_hash != _hash_pw(body.password):
        raise HTTPException(401, "Invalid email or password")

    # Issue portal JWT with customer context
    token = issue_portal_token(
        user_id=str(u.id),
        email=u.email,
        first_name=u.first_name or "",
        last_name=u.last_name or "",
        customer_id=u.customer_id,
        is_admin=u.is_admin,
    )
    customer = (await db.execute(
        select(TicketCustomer).where(TicketCustomer.id == u.customer_id)
    )).scalar_one_or_none()
    return {
        "token": token,
        "user": {
            "id": u.id, "email": u.email,
            "first_name": u.first_name, "last_name": u.last_name,
            "is_admin": u.is_admin, "customer_id": u.customer_id,
            "customer_name": customer.name if customer else "",
        }
    }

@router.get("/me")
async def portal_me(request: Request, db: AsyncSession = Depends(get_db)):
    u = _require_portal_user(request)
    portal_user = (await db.execute(
        select(PortalUser).where(PortalUser.id == int(u["id"]))
    )).scalar_one_or_none()
    if not portal_user:
        raise HTTPException(404, "User not found")
    customer = (await db.execute(
        select(TicketCustomer).where(TicketCustomer.id == portal_user.customer_id)
    )).scalar_one_or_none()
    return {
        "id": portal_user.id, "email": portal_user.email,
        "first_name": portal_user.first_name, "last_name": portal_user.last_name,
        "is_admin": portal_user.is_admin, "customer_id": portal_user.customer_id,
        "customer_name": customer.name if customer else "",
        "customer": _clean(customer.__dict__) if customer else None,
    }

@router.get("/ticketing-mode")
async def portal_ticketing_mode(request: Request, db: AsyncSession = Depends(get_db)):
    """Returns the active ticketing mode so the portal can adapt its UI."""
    _require_portal_user(request)
    mode = await _get_ticketing_mode(db)
    provider_label = {"freshservice": "Freshservice", "jira": "Jira", "servicenow": "ServiceNow", "zendesk": "Zendesk"}
    return {
        "native":     mode["native"],
        "provider":   mode["provider"],
        "configured": mode["configured"],
        "provider_label": provider_label.get(mode["provider"], mode["provider"]) if mode["provider"] else None,
    }

# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def portal_dashboard(request: Request, db: AsyncSession = Depends(get_db)):
    u = _require_portal_user(request)
    cid = u["customer_id"]

    async def cnt(where=None):
        s = select(func.count(Ticket.id)).where(Ticket.customer_id == cid)
        if where is not None:
            s = s.where(where)
        return (await db.execute(s)).scalar() or 0

    open_count     = await cnt(Ticket.status.in_(["open", "in_progress", "pending", "waiting"]))
    resolved_count = await cnt(Ticket.status.in_(["resolved", "closed"]))
    my_open        = await cnt(Ticket.requester_portal == int(u["id"]))

    # Recent tickets for this customer (last 5)
    recent_stmt = (
        select(Ticket)
        .where(Ticket.customer_id == cid)
        .order_by(Ticket.updated_at.desc())
        .limit(5)
    )
    recent = (await db.execute(recent_stmt)).scalars().all()

    # Portal user count
    user_count = (await db.execute(
        select(func.count(PortalUser.id)).where(PortalUser.customer_id == cid)
    )).scalar() or 0

    customer = (await db.execute(
        select(TicketCustomer).where(TicketCustomer.id == cid)
    )).scalar_one_or_none()

    return {
        "open_tickets":     open_count,
        "resolved_tickets": resolved_count,
        "my_open_tickets":  my_open,
        "portal_users":     user_count,
        "sla_response_hr":  customer.sla_response_hr if customer else 4,
        "sla_resolve_hr":   customer.sla_resolve_hr  if customer else 24,
        "tier":             customer.tier             if customer else "standard",
        "recent_tickets":   [_ticket_dict(t) for t in recent],
    }

# ── Tickets ───────────────────────────────────────────────────────────────────

class TicketIn(BaseModel):
    title:       str
    description: str = ""
    priority:    str = "medium"
    type:        str = "service_request"

class CommentIn(BaseModel):
    body: str

@router.get("/tickets")
async def portal_tickets(
    request: Request,
    status:  str | None = None,
    mine:    bool = False,
    limit:   int = 60,
    db: AsyncSession = Depends(get_db),
):
    u = _require_portal_user(request)

    mode = await _get_ticketing_mode(db)
    if not mode["native"] and mode["configured"]:
        tickets = await _dispatch_list(mode["provider"], mode["pcfg"], {"status": status or "all"})
        if mine and u.get("email"):
            tickets = [t for t in tickets if u["email"].lower() in (t.get("requester_email") or "").lower()]
        return {"total": len(tickets), "tickets": tickets, "provider": mode["provider"]}

    cid = u["customer_id"]
    stmt = select(Ticket).where(Ticket.customer_id == cid).order_by(Ticket.updated_at.desc())
    if mine:
        stmt = stmt.where(Ticket.requester_portal == int(u["id"]))
    if status:
        stmt = stmt.where(Ticket.status == status)
    total  = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    result = await db.execute(stmt.limit(limit))
    return {"total": total, "tickets": [_ticket_dict(t) for t in result.scalars().all()]}

@router.post("/tickets", status_code=201)
async def portal_submit_ticket(body: TicketIn, request: Request, db: AsyncSession = Depends(get_db)):
    u = _require_portal_user(request)

    mode = await _get_ticketing_mode(db)
    if not mode["native"] and mode["configured"]:
        payload = {
            "subject":         body.title,
            "description":     body.description or "",
            "priority":        body.priority,
            "type":            body.type,
            "requester_email": u.get("email", ""),
            "tags":            [],
        }
        return await _dispatch_create(mode["provider"], mode["pcfg"], payload)

    cid = u["customer_id"]
    prefix = {"service_request": "SVC", "incident": "INC"}.get(body.type, "SVC")
    count = (await db.execute(select(func.count(Ticket.id)))).scalar() or 0
    number = f"{prefix}-{str(count + 1).zfill(5)}"

    now = _now()
    customer = (await db.execute(
        select(TicketCustomer).where(TicketCustomer.id == cid)
    )).scalar_one_or_none()

    from datetime import timedelta
    priority_mult = {"critical": 0.25, "high": 0.5, "medium": 1.0, "low": 2.0}.get(body.priority, 1.0)
    resolve_hr = (customer.sla_resolve_hr if customer else 24) * priority_mult
    sla_resolve_due = (datetime.now(timezone.utc) + timedelta(hours=resolve_hr)).isoformat()

    t = Ticket(
        number=number, type=body.type, status="open",
        priority=body.priority, title=body.title, description=body.description,
        customer_id=cid, requester_portal=int(u["id"]),
        source="portal", sla_resolve_due=sla_resolve_due,
        tags=json.dumps([]), created_at=now, updated_at=now,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _ticket_dict(t)

@router.get("/tickets/{ticket_id}")
async def portal_get_ticket(ticket_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    u = _require_portal_user(request)

    mode = await _get_ticketing_mode(db)
    if not mode["native"] and mode["configured"]:
        return await _dispatch_get(mode["provider"], mode["pcfg"], str(ticket_id))

    t = (await db.execute(
        select(Ticket).where(Ticket.id == int(ticket_id), Ticket.customer_id == u["customer_id"])
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Ticket not found")
    comments = (await db.execute(
        select(TicketComment)
        .where(TicketComment.ticket_id == int(ticket_id), TicketComment.is_internal == False)
        .order_by(TicketComment.created_at)
    )).scalars().all()
    return _ticket_dict(t, comments)

@router.post("/tickets/{ticket_id}/comments", status_code=201)
async def portal_add_comment(ticket_id: str, body: CommentIn, request: Request, db: AsyncSession = Depends(get_db)):
    u = _require_portal_user(request)

    mode = await _get_ticketing_mode(db)
    if not mode["native"] and mode["configured"]:
        return await _dispatch_comment(mode["provider"], mode["pcfg"], str(ticket_id), body.body, False)

    t = (await db.execute(
        select(Ticket).where(Ticket.id == int(ticket_id), Ticket.customer_id == u["customer_id"])
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Ticket not found")
    now = _now()
    c = TicketComment(
        ticket_id=int(ticket_id), body=body.body, is_internal=False,
        author_portal_id=int(u["id"]), created_at=now,
    )
    db.add(c)
    if t.status == "open":
        t.status = "in_progress"
    t.updated_at = now
    await db.commit()
    await db.refresh(c)
    return _clean(c.__dict__)
