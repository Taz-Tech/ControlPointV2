"""
Core ticketing system — customers, portal users, tickets, comments, projects, change requests.
"""
import json
import re
import secrets
import hashlib
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    TicketCustomer, PortalUser, Ticket, TicketComment,
    TicketProject, ChangeRequest, UserRecord, TicketSystemConfig,
    TicketGroup, TicketAttachment, TicketActivity,
    ProblemRecord, ProblemAsset, DeviceRecord,
    TicketKBLink, TicketInventoryAssetLink, Asset, KBArticle,
)
from .notifications import fire_ticket_notification
from .events import broadcast

_UPLOADS = Path(__file__).parent.parent / "uploads" / "ticket_attachments"

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

router = APIRouter(prefix="/api/tickets", tags=["ticketing"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

TICKET_STATUSES = [
    "open", "assigned", "in_progress", "scheduled",
    "waiting_on_customer", "waiting_on_third_party",
    "pending", "escalated",
    "resolved", "closed", "canceled",
]
# Statuses that count as "active / not done"
ACTIVE_STATUSES = ["open", "assigned", "in_progress", "scheduled",
                   "waiting_on_customer", "waiting_on_third_party",
                   "pending", "escalated"]
# Statuses that count as "done"
DONE_STATUSES   = ["resolved", "closed", "canceled"]

TYPE_PREFIX = {
    "incident":        "INC",
    "service_request": "SVC",
    "task":            "TSK",
    "change":          "CHG",
    "project_task":    "TSK",
    "problem":         "PRB",
}

async def _next_ticket_number(db: AsyncSession, ticket_type: str) -> str:
    prefix = TYPE_PREFIX.get(ticket_type, "TKT")
    # All types sharing this prefix contribute to the same sequence
    shared_types = [t for t, p in TYPE_PREFIX.items() if p == prefix]
    result = await db.execute(
        select(func.max(Ticket.number)).where(Ticket.type.in_(shared_types))
    )
    max_num = result.scalar()
    if max_num and '-' in max_num:
        try:
            count = int(max_num.split('-', 1)[1]) + 1
        except ValueError:
            count = 1
    else:
        count = 1
    return f"{prefix}-{count:05d}"

def _sla_due(customer: TicketCustomer | None, priority: str, kind: str) -> str | None:
    if not customer:
        return None
    base_response = customer.sla_response_hr
    base_resolve  = customer.sla_resolve_hr
    multipliers   = {"low": 2.0, "medium": 1.0, "high": 0.5, "critical": 0.25}
    mult = multipliers.get(priority, 1.0)
    hours = (base_response if kind == "response" else base_resolve) * mult
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()

def _staff_id(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    return user.get("id") if user else None

def _require_staff(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Authentication required")
    return user

def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CustomerIn(BaseModel):
    name:            str
    domain:          str | None = None
    tier:            str = "standard"
    sla_response_hr: int = 4
    sla_resolve_hr:  int = 24
    portal_enabled:  bool = True
    notes:           str | None = None

class PortalUserIn(BaseModel):
    email:      str
    first_name: str = ""
    last_name:  str = ""
    password:   str | None = None
    is_admin:   bool = False

# Default ITIL priority matrix — keys are "{urgency}_{impact}"
_DEFAULT_MATRIX = {
    "low_low":      "low",
    "low_medium":   "low",
    "low_high":     "medium",
    "medium_low":   "low",
    "medium_medium":"medium",
    "medium_high":  "high",
    "high_low":     "medium",
    "high_medium":  "high",
    "high_high":    "critical",
}

def _calc_priority(urgency: str | None, impact: str | None, matrix: dict | None = None) -> str | None:
    if urgency and impact:
        m = matrix if matrix is not None else _DEFAULT_MATRIX
        return m.get(f"{urgency}_{impact}")
    return None

class TicketIn(BaseModel):
    type:        str
    title:       str
    description: str | None = None
    priority:    str = "medium"
    urgency:     str | None = None
    impact:      str | None = None
    category:    str | None = None
    customer_id: int | None = None
    group_id:    int | None = None
    assigned_to: str | None = None
    assigned_team: str | None = None
    requester_name:  str | None = None
    requester_email: str | None = None
    requester_phone: str | None = None
    desk_location:   str | None = None
    project_id:      int | None = None
    parent_ticket_id: int | None = None
    due_date:    str | None = None
    planned_start:   str | None = None
    planned_end:     str | None = None
    planned_effort:  float | None = None
    tags:        list[str] = []
    source:      str = "portal"
    # Change-specific
    change_type:         str | None = None
    change_impact:       str | None = None   # ChangeRequest.impact (different from ticket impact)
    risk:                str | None = None
    implementation_plan: str | None = None
    rollback_plan:       str | None = None
    scheduled_start:     str | None = None
    scheduled_end:       str | None = None
    # Problem-specific
    root_cause:          str | None = None
    workaround:          str | None = None
    known_error:         bool = False
    affected_services:   str | None = None

class TicketUpdate(BaseModel):
    title:           str | None = None
    description:     str | None = None
    status:          str | None = None
    priority:        str | None = None
    urgency:         str | None = None
    impact:          str | None = None
    category:        str | None = None
    group_id:        int | None = None
    assigned_to:     str | None = None
    assigned_team:   str | None = None
    requester_name:  str | None = None
    requester_email: str | None = None
    requester_phone: str | None = None
    desk_location:   str | None = None
    due_date:        str | None = None
    planned_start:   str | None = None
    planned_end:     str | None = None
    planned_effort:  float | None = None
    tags:            list[str] | None = None
    project_id:      int | None = None
    customer_id:     int | None = None
    problem_id:      int | None = None

class CommentIn(BaseModel):
    body:        str
    is_internal: bool = False
    mentions:    list[str] = []   # explicit user IDs selected via @mention dropdown

class ProjectIn(BaseModel):
    name:        str
    description: str | None = None
    customer_id: int | None = None
    priority:    str = "medium"
    status:      str = "planning"
    start_date:  str | None = None
    end_date:    str | None = None
    due_date:    str | None = None  # alias for end_date
    manager_id:  str | None = None

class ChangeUpdate(BaseModel):
    change_type:         str | None = None
    impact:              str | None = None
    risk:                str | None = None
    implementation_plan: str | None = None
    rollback_plan:       str | None = None
    scheduled_start:     str | None = None
    scheduled_end:       str | None = None
    approval_status:     str | None = None

class ProblemUpdate(BaseModel):
    root_cause:        str | None = None
    workaround:        str | None = None
    known_error:       bool | None = None
    affected_services: str | None = None

class ProblemAssetIn(BaseModel):
    asset_type:       str = "device"   # device | server | network | other
    asset_name:       str
    asset_identifier: str | None = None
    device_record_id: int | None = None

# ── Agents (staff users available for assignment) ─────────────────────────────

@router.get("/agents")
async def list_agents(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(UserRecord).order_by(UserRecord.first_name, UserRecord.last_name))).scalars().all()
    return [{"id": u.id, "email": u.email, "name": u.name} for u in rows]


# ── Customers ────────────────────────────────────────────────────────────────

@router.get("/customers")
async def list_customers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TicketCustomer).order_by(TicketCustomer.name))
    customers = result.scalars().all()
    out = []
    for c in customers:
        ticket_count = (await db.execute(
            select(func.count(Ticket.id)).where(Ticket.customer_id == c.id)
        )).scalar() or 0
        user_count = (await db.execute(
            select(func.count(PortalUser.id)).where(PortalUser.customer_id == c.id)
        )).scalar() or 0
        out.append({**c.__dict__, "_sa_instance_state": None,
                    "ticket_count": ticket_count, "user_count": user_count})
    return [_clean(c) for c in out]

@router.post("/customers", status_code=201)
async def create_customer(body: CustomerIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    slug = _slug(body.name)
    existing = (await db.execute(select(TicketCustomer).where(TicketCustomer.slug == slug))).scalar_one_or_none()
    if existing:
        slug = f"{slug}-{secrets.token_hex(3)}"
    c = TicketCustomer(name=body.name, slug=slug, domain=body.domain,
                       tier=body.tier, sla_response_hr=body.sla_response_hr,
                       sla_resolve_hr=body.sla_resolve_hr, portal_enabled=body.portal_enabled,
                       notes=body.notes, created_at=_now())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _clean(c.__dict__)

@router.put("/customers/{customer_id}")
async def update_customer(customer_id: int, body: CustomerIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    c = await _get_or_404(db, TicketCustomer, customer_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    await db.commit()
    return _clean(c.__dict__)

@router.delete("/customers/{customer_id}", status_code=204)
async def delete_customer(customer_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    c = await _get_or_404(db, TicketCustomer, customer_id)
    await db.delete(c)
    await db.commit()

# ── Portal Users ──────────────────────────────────────────────────────────────

@router.get("/portal-users/all")
async def list_all_portal_users(db: AsyncSession = Depends(get_db)):
    """Return all portal users across all clients, with customer name attached."""
    users = (await db.execute(
        select(PortalUser).order_by(PortalUser.last_name, PortalUser.first_name)
    )).scalars().all()
    cust_ids = list({u.customer_id for u in users})
    cust_map: dict[int, str] = {}
    if cust_ids:
        custs = (await db.execute(
            select(TicketCustomer).where(TicketCustomer.id.in_(cust_ids))
        )).scalars().all()
        cust_map = {c.id: c.name for c in custs}
    out = []
    for u in users:
        d = _clean(u.__dict__)
        d["customer_name"] = cust_map.get(u.customer_id, "")
        d["name"] = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
        d["user_source"] = "client"
        out.append(d)
    return out


@router.get("/customers/{customer_id}/portal-users")
async def list_portal_users(customer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PortalUser).where(PortalUser.customer_id == customer_id)
        .order_by(PortalUser.last_name, PortalUser.first_name)
    )
    return [_clean(u.__dict__) for u in result.scalars()]

@router.post("/customers/{customer_id}/portal-users", status_code=201)
async def create_portal_user(customer_id: int, body: PortalUserIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    await _get_or_404(db, TicketCustomer, customer_id)
    existing = (await db.execute(select(PortalUser).where(PortalUser.email == body.email.lower()))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Portal user {body.email} already exists")
    invite_token = secrets.token_urlsafe(32)
    u = PortalUser(
        customer_id=customer_id, email=body.email.lower(),
        first_name=body.first_name, last_name=body.last_name,
        password_hash=_hash_password(body.password) if body.password else None,
        is_admin=body.is_admin, invite_token=invite_token, created_at=_now(),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return _clean(u.__dict__)

@router.put("/customers/{customer_id}/portal-users/{user_id}")
async def update_portal_user(customer_id: int, user_id: int, body: PortalUserIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    u = await _get_or_404(db, PortalUser, user_id)
    if u.customer_id != customer_id:
        raise HTTPException(404)
    u.first_name = body.first_name
    u.last_name  = body.last_name
    u.is_admin   = body.is_admin
    if body.password:
        u.password_hash = _hash_password(body.password)
    await db.commit()
    return _clean(u.__dict__)

@router.delete("/customers/{customer_id}/portal-users/{user_id}", status_code=204)
async def delete_portal_user(customer_id: int, user_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    u = await _get_or_404(db, PortalUser, user_id)
    if u.customer_id != customer_id:
        raise HTTPException(404)
    await db.delete(u)
    await db.commit()

# ── Tickets ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_tickets(
    request: Request,
    db:           AsyncSession = Depends(get_db),
    type:         str | None = None,
    status:       str | None = None,
    priority:     str | None = None,
    customer_id:  int | None = None,
    assigned_to:  str | None = None,
    project_id:   int | None = None,
    q:            str | None = None,
    limit:        int = 100,
    offset:       int = 0,
    overdue:      bool = False,
    due_today:    bool = False,
    unassigned:   bool = False,
    sla_breached: bool = False,
):
    from datetime import date as _date
    stmt = select(Ticket).order_by(Ticket.created_at.desc())
    if type:
        type_parts = [t.strip() for t in type.split(',') if t.strip()]
        if len(type_parts) == 1:
            stmt = stmt.where(Ticket.type == type_parts[0])
        else:
            stmt = stmt.where(Ticket.type.in_(type_parts))
    else:
        # Tasks and project tasks are only surfaced in their dedicated views
        stmt = stmt.where(Ticket.type.notin_(['task', 'project_task']))
    if status:
        parts = [s.strip() for s in status.split(',')]
        stmt = stmt.where(Ticket.status.in_(parts))
    if priority:    stmt = stmt.where(Ticket.priority    == priority)
    if customer_id: stmt = stmt.where(Ticket.customer_id == customer_id)
    if assigned_to:
        if assigned_to == 'me':
            user = getattr(request.state, 'user', None)
            if user:
                stmt = stmt.where(Ticket.assigned_to == user.get('id'))
        else:
            stmt = stmt.where(Ticket.assigned_to == assigned_to)
    if project_id:  stmt = stmt.where(Ticket.project_id  == project_id)
    if q:
        stmt = stmt.where(or_(Ticket.title.ilike(f"%{q}%"), Ticket.description.ilike(f"%{q}%")))
    if unassigned:
        stmt = stmt.where(Ticket.assigned_to == None, Ticket.status.in_(ACTIVE_STATUSES))
    if sla_breached:
        _now_iso = datetime.now(timezone.utc).isoformat()
        stmt = stmt.where(
            Ticket.sla_resolve_due.isnot(None),
            Ticket.sla_resolve_due < _now_iso,
            Ticket.status.in_(ACTIVE_STATUSES),
        )
    if overdue:
        today = _date.today().isoformat()
        stmt = stmt.where(Ticket.due_date.isnot(None), Ticket.due_date < today, Ticket.status.in_(ACTIVE_STATUSES))
    if due_today:
        today     = _date.today().isoformat()
        tomorrow  = (_date.today() + timedelta(days=1)).isoformat()
        stmt = stmt.where(Ticket.due_date.isnot(None), Ticket.due_date >= today, Ticket.due_date < tomorrow, Ticket.status.in_(ACTIVE_STATUSES))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    result = await db.execute(stmt.limit(limit).offset(offset))
    tickets = result.scalars().all()
    ticket_dicts = await _with_agent_names([_ticket_dict(t) for t in tickets], db)
    return {"total": total, "tickets": ticket_dicts}

@router.post("", status_code=201)
async def create_ticket(body: TicketIn, request: Request, db: AsyncSession = Depends(get_db)):
    staff = _require_staff(request)
    customer = None
    if body.customer_id:
        customer = (await db.execute(select(TicketCustomer).where(TicketCustomer.id == body.customer_id))).scalar_one_or_none()

    number   = await _next_ticket_number(db, body.type)
    now      = _now()
    settings = await _get_settings(db)
    # Derive priority from the configured urgency×impact matrix if both are set
    computed_priority = _calc_priority(body.urgency, body.impact, settings.get("priority_matrix")) or body.priority
    t = Ticket(
        number=number, type=body.type, status="open",
        priority=computed_priority,
        urgency=body.urgency, impact=body.impact,
        title=body.title, description=body.description,
        customer_id=body.customer_id,
        group_id=body.group_id,
        category=body.category,
        requester_staff=staff["id"],
        requester_name=body.requester_name,
        requester_email=body.requester_email,
        requester_phone=body.requester_phone,
        desk_location=body.desk_location,
        assigned_to=body.assigned_to,
        assigned_team=body.assigned_team,
        project_id=body.project_id,
        parent_ticket_id=body.parent_ticket_id,
        due_date=body.due_date,
        planned_start=body.planned_start,
        planned_end=body.planned_end,
        planned_effort=body.planned_effort,
        tags=json.dumps(body.tags), source=body.source,
        sla_response_due=_sla_due(customer, computed_priority, "response"),
        sla_resolve_due=_sla_due(customer, computed_priority, "resolve"),
        created_at=now, updated_at=now,
    )
    db.add(t)
    await db.flush()

    # Create ChangeRequest record if type is change
    if body.type == "change":
        cr = ChangeRequest(
            ticket_id=t.id,
            change_type=body.change_type or "standard",
            impact=body.change_impact or "low",
            risk=body.risk or "low",
            implementation_plan=body.implementation_plan,
            rollback_plan=body.rollback_plan,
            scheduled_start=body.scheduled_start,
            scheduled_end=body.scheduled_end,
        )
        db.add(cr)

    # Create ProblemRecord if type is problem
    if body.type == "problem":
        pr = ProblemRecord(
            ticket_id=t.id,
            root_cause=body.root_cause,
            workaround=body.workaround,
            known_error=body.known_error or False,
            affected_services=body.affected_services,
        )
        db.add(pr)

    await db.commit()
    await db.refresh(t)

    # Fire assignment notifications
    if t.assigned_to:
        await fire_ticket_notification(db, "ticket_assigned", t, changed_by_id=staff["id"], new_assignee_id=t.assigned_to)
    if t.group_id:
        await fire_ticket_notification(db, "ticket_group_assigned", t, changed_by_id=staff["id"], new_group_id=t.group_id)
    if t.assigned_to or t.group_id:
        await db.commit()

    broadcast("ticket_created", {"ticket_id": t.id, "number": t.number, "type": t.type})
    return await _with_agent_name(_ticket_dict(t), db)

@router.get("/{ticket_id}")
async def get_ticket(ticket_id: int, db: AsyncSession = Depends(get_db)):
    t = await _get_or_404(db, Ticket, ticket_id)
    d = await _with_agent_name(_ticket_dict(t), db)
    # Attach change request if exists
    cr = (await db.execute(select(ChangeRequest).where(ChangeRequest.ticket_id == ticket_id))).scalar_one_or_none()
    if cr:
        d["change_request"] = _clean(cr.__dict__)
    # Attach problem record + linked tickets + assets if this is a problem ticket
    pr = (await db.execute(select(ProblemRecord).where(ProblemRecord.ticket_id == ticket_id))).scalar_one_or_none()
    if pr:
        d["problem_record"] = _clean(pr.__dict__)
        # Linked tickets (incidents/others that have this problem_id)
        linked = (await db.execute(
            select(Ticket).where(Ticket.problem_id == ticket_id).order_by(Ticket.created_at.desc())
        )).scalars().all()
        d["linked_tickets"] = [_ticket_dict(lt) for lt in linked]
        # Linked assets
        assets = (await db.execute(
            select(ProblemAsset).where(ProblemAsset.ticket_id == ticket_id).order_by(ProblemAsset.added_at)
        )).scalars().all()
        d["problem_assets"] = [_clean(a.__dict__) for a in assets]
    # Attach comments — enrich with agent display name
    comments = (await db.execute(
        select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at)
    )).scalars().all()
    staff_ids = {c.author_staff_id for c in comments if c.author_staff_id}
    staff_map: dict[str, str] = {}
    if staff_ids:
        staff_rows = (await db.execute(select(UserRecord).where(UserRecord.id.in_(staff_ids)))).scalars().all()
        staff_map = {r.id: (r.name or f"{r.first_name} {r.last_name}".strip() or r.email) for r in staff_rows}
    # Fetch all attachments for this ticket up front (ticket-level + comment-level)
    all_atts = (await db.execute(
        select(TicketAttachment).where(TicketAttachment.ticket_id == ticket_id).order_by(TicketAttachment.uploaded_at)
    )).scalars().all()
    att_by_comment: dict[int, list] = {}
    for a in all_atts:
        if a.comment_id:
            att_by_comment.setdefault(a.comment_id, []).append(_clean(a.__dict__))

    comment_dicts = []
    for c in comments:
        cd = _clean(c.__dict__)
        if c.author_staff_id:
            cd["author_name"] = staff_map.get(c.author_staff_id, "Agent")
        cd["attachments"] = att_by_comment.get(c.id, [])
        comment_dicts.append(cd)
    d["comments"] = comment_dicts
    # Attach activity log
    activities = (await db.execute(
        select(TicketActivity).where(TicketActivity.ticket_id == ticket_id).order_by(TicketActivity.changed_at)
    )).scalars().all()
    d["activities"] = [_clean(a.__dict__) for a in activities]
    # Attach requester info (prefer explicit fields, fall back to linked record)
    if not d.get("requester_name"):
        if t.requester_staff:
            staff_rec = (await db.execute(select(UserRecord).where(UserRecord.id == t.requester_staff))).scalar_one_or_none()
            if staff_rec:
                d["requester_name"]  = staff_rec.name
                d["requester_email"] = staff_rec.email
        elif t.requester_portal:
            pu = (await db.execute(select(PortalUser).where(PortalUser.id == t.requester_portal))).scalar_one_or_none()
            if pu:
                d["requester_name"]  = f"{pu.first_name} {pu.last_name}".strip()
                d["requester_email"] = pu.email
    # Attach group name
    if t.group_id:
        grp = (await db.execute(select(TicketGroup).where(TicketGroup.id == t.group_id))).scalar_one_or_none()
        if grp:
            d["group_name"] = grp.name
            d["group_color"] = grp.color
    # Ticket-level attachments only (no comment_id)
    d["attachments"] = [_clean(a.__dict__) for a in all_atts if not a.comment_id]

    # Attach linked KB articles
    kb_links = (await db.execute(
        select(TicketKBLink).where(TicketKBLink.ticket_id == ticket_id).order_by(TicketKBLink.linked_at)
    )).scalars().all()
    if kb_links:
        article_ids = [l.kb_article_id for l in kb_links]
        articles = (await db.execute(
            select(KBArticle).where(KBArticle.id.in_(article_ids))
        )).scalars().all()
        art_map = {a.id: a for a in articles}
        d["kb_articles"] = [
            {"link_id": l.id, "article_id": l.kb_article_id, "linked_at": l.linked_at,
             "title": art_map[l.kb_article_id].title if l.kb_article_id in art_map else "",
             "slug":  art_map[l.kb_article_id].slug  if l.kb_article_id in art_map else "",
             "summary": art_map[l.kb_article_id].summary if l.kb_article_id in art_map else ""}
            for l in kb_links if l.kb_article_id in art_map
        ]
    else:
        d["kb_articles"] = []

    # Attach linked inventory assets
    asset_links = (await db.execute(
        select(TicketInventoryAssetLink).where(TicketInventoryAssetLink.ticket_id == ticket_id).order_by(TicketInventoryAssetLink.linked_at)
    )).scalars().all()
    if asset_links:
        asset_ids = [l.asset_id for l in asset_links]
        inv_assets = (await db.execute(
            select(Asset).where(Asset.id.in_(asset_ids))
        )).scalars().all()
        asset_map = {a.id: a for a in inv_assets}
        d["inventory_assets"] = [
            {"link_id": l.id, "asset_id": l.asset_id, "linked_at": l.linked_at,
             **{k: v for k, v in _clean(asset_map[l.asset_id].__dict__).items()
                if k in ("tag", "name", "asset_type", "status", "serial_number", "model", "manufacturer", "assigned_to", "assigned_name", "location")}}
            for l in asset_links if l.asset_id in asset_map
        ]
    else:
        d["inventory_assets"] = []

    # Attach child task tickets linked via parent_ticket_id
    child_tasks = (await db.execute(
        select(Ticket)
        .where(Ticket.parent_ticket_id == ticket_id)
        .where(Ticket.type == "task")
        .order_by(Ticket.created_at)
    )).scalars().all()
    d["subtasks"] = [_ticket_dict(ct) for ct in child_tasks]

    return d

_TRACKED_FIELDS = {
    "title":          "Subject",
    "status":         "Status",
    "priority":       "Priority",
    "urgency":        "Urgency",
    "impact":         "Impact",
    "assigned_to":    "Assigned To",
    "assigned_team":  "Team",
    "group_id":       "Group",
    "category":       "Category",
    "due_date":       "Due Date",
    "planned_start":  "Planned Start",
    "planned_end":    "Planned End",
    "planned_effort": "Planned Effort",
    "requester_name": "Requester",
    "customer_id":    "Client",
}

@router.put("/{ticket_id}")
async def update_ticket(ticket_id: int, body: TicketUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    staff = _require_staff(request)
    t = await _get_or_404(db, Ticket, ticket_id)
    now = _now()

    # Snapshot notification-relevant fields before changes
    old_assigned_to = t.assigned_to
    old_group_id    = t.group_id
    old_status      = t.status
    old_priority    = t.priority

    # Snapshot tracked fields before changes
    old_vals = {f: getattr(t, f, None) for f in _TRACKED_FIELDS}

    if body.title           is not None: t.title           = body.title
    if body.description     is not None: t.description     = body.description
    if body.assigned_to     is not None: t.assigned_to     = body.assigned_to
    if body.assigned_team   is not None: t.assigned_team   = body.assigned_team
    if body.group_id        is not None: t.group_id        = body.group_id
    if body.category        is not None: t.category        = body.category
    if body.customer_id     is not None: t.customer_id     = body.customer_id
    if body.requester_name  is not None: t.requester_name  = body.requester_name
    if body.requester_email is not None: t.requester_email = body.requester_email
    if body.requester_phone is not None: t.requester_phone = body.requester_phone
    if body.desk_location   is not None: t.desk_location   = body.desk_location
    if body.due_date        is not None: t.due_date        = body.due_date
    if body.planned_start   is not None: t.planned_start   = body.planned_start
    if body.planned_end     is not None: t.planned_end     = body.planned_end
    if body.planned_effort  is not None: t.planned_effort  = body.planned_effort
    if body.tags            is not None: t.tags            = json.dumps(body.tags)
    if body.project_id      is not None: t.project_id      = body.project_id
    if body.problem_id      is not None: t.problem_id      = body.problem_id

    urgency_changed = body.urgency is not None
    impact_changed  = body.impact  is not None
    if urgency_changed: t.urgency = body.urgency
    if impact_changed:  t.impact  = body.impact
    if urgency_changed or impact_changed:
        settings = await _get_settings(db)
        computed = _calc_priority(t.urgency, t.impact, settings.get("priority_matrix"))
        if computed:
            t.priority = computed
    elif body.priority is not None:
        t.priority = body.priority

    if body.status is not None:
        t.status = body.status
        if body.status == "resolved" and not t.resolved_at:
            t.resolved_at = now
        if body.status in ("closed", "canceled") and not t.closed_at:
            t.closed_at = now

    # Recompute sla_breached: True only for active tickets past their resolve due date
    _done = {"resolved", "closed", "canceled"}
    if t.status in _done:
        t.sla_breached = False
    elif t.sla_resolve_due:
        t.sla_breached = t.sla_resolve_due < now
    else:
        t.sla_breached = False

    t.updated_at = now

    # Build agent display name for activity log
    actor_name = staff.get("email", "Unknown")
    actor_rec = (await db.execute(select(UserRecord).where(UserRecord.id == staff["id"]))).scalar_one_or_none()
    if actor_rec:
        actor_name = actor_rec.name or f"{actor_rec.first_name} {actor_rec.last_name}".strip() or actor_rec.email

    # Resolve group names for display
    group_names: dict[int, str] = {}
    for fld in ("group_id",):
        old_id = old_vals.get(fld)
        new_id = getattr(t, fld, None)
        for gid in filter(None, {old_id, new_id}):
            if gid not in group_names:
                g = (await db.execute(select(TicketGroup).where(TicketGroup.id == gid))).scalar_one_or_none()
                if g:
                    group_names[gid] = g.name

    # Log changed tracked fields
    for fld, label in _TRACKED_FIELDS.items():
        old_v = old_vals.get(fld)
        new_v = getattr(t, fld, None)
        if str(old_v or "") == str(new_v or ""):
            continue
        # Use group name for display
        def _display(v):
            if fld == "group_id" and v is not None:
                return group_names.get(int(v), str(v))
            return str(v) if v is not None else ""
        db.add(TicketActivity(
            ticket_id=ticket_id,
            changed_by=staff["id"],
            changed_by_name=actor_name,
            field=label,
            old_value=_display(old_v),
            new_value=_display(new_v),
            changed_at=now,
        ))

    await db.commit()

    # Fire notifications for changed fields
    notif_fired = False
    if t.assigned_to and t.assigned_to != old_assigned_to:
        await fire_ticket_notification(db, "ticket_assigned", t, changed_by_id=staff["id"], new_assignee_id=t.assigned_to)
        notif_fired = True
    if t.group_id and t.group_id != old_group_id:
        await fire_ticket_notification(db, "ticket_group_assigned", t, changed_by_id=staff["id"], new_group_id=t.group_id)
        notif_fired = True
    if t.status != old_status:
        if t.status in ("resolved", "closed"):
            await fire_ticket_notification(db, "ticket_resolved", t, changed_by_id=staff["id"])
        else:
            await fire_ticket_notification(db, "ticket_status_changed", t, changed_by_id=staff["id"])
        notif_fired = True
    if t.priority != old_priority:
        await fire_ticket_notification(db, "ticket_priority_changed", t, changed_by_id=staff["id"])
        notif_fired = True
    if notif_fired:
        await db.commit()

    broadcast("ticket_updated", {"ticket_id": t.id, "number": t.number})
    return await _with_agent_name(_ticket_dict(t), db)

@router.delete("/{ticket_id}", status_code=204)
async def delete_ticket(ticket_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    t = await _get_or_404(db, Ticket, ticket_id)
    await db.delete(t)
    await db.commit()

# ── Ticket KB Links ───────────────────────────────────────────────────────────

@router.get("/{ticket_id}/kb")
async def list_ticket_kb(ticket_id: int, db: AsyncSession = Depends(get_db)):
    await _get_or_404(db, Ticket, ticket_id)
    links = (await db.execute(
        select(TicketKBLink).where(TicketKBLink.ticket_id == ticket_id).order_by(TicketKBLink.linked_at)
    )).scalars().all()
    if not links:
        return []
    art_ids = [l.kb_article_id for l in links]
    articles = (await db.execute(select(KBArticle).where(KBArticle.id.in_(art_ids)))).scalars().all()
    art_map = {a.id: a for a in articles}
    return [
        {"link_id": l.id, "article_id": l.kb_article_id, "linked_at": l.linked_at,
         "title": art_map[l.kb_article_id].title if l.kb_article_id in art_map else "",
         "slug":  art_map[l.kb_article_id].slug  if l.kb_article_id in art_map else "",
         "summary": art_map[l.kb_article_id].summary if l.kb_article_id in art_map else ""}
        for l in links if l.kb_article_id in art_map
    ]

@router.post("/{ticket_id}/kb/{article_id}", status_code=201)
async def link_ticket_kb(ticket_id: int, article_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    await _get_or_404(db, Ticket, ticket_id)
    await _get_or_404(db, KBArticle, article_id)
    existing = (await db.execute(
        select(TicketKBLink)
        .where(TicketKBLink.ticket_id == ticket_id)
        .where(TicketKBLink.kb_article_id == article_id)
    )).scalar_one_or_none()
    if existing:
        return _clean(existing.__dict__)
    link = TicketKBLink(ticket_id=ticket_id, kb_article_id=article_id, linked_at=_now())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _clean(link.__dict__)

@router.delete("/{ticket_id}/kb/{article_id}", status_code=204)
async def unlink_ticket_kb(ticket_id: int, article_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    link = (await db.execute(
        select(TicketKBLink)
        .where(TicketKBLink.ticket_id == ticket_id)
        .where(TicketKBLink.kb_article_id == article_id)
    )).scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()

# ── Ticket Inventory Asset Links ──────────────────────────────────────────────

@router.get("/{ticket_id}/inventory-assets")
async def list_ticket_inventory_assets(ticket_id: int, db: AsyncSession = Depends(get_db)):
    await _get_or_404(db, Ticket, ticket_id)
    links = (await db.execute(
        select(TicketInventoryAssetLink)
        .where(TicketInventoryAssetLink.ticket_id == ticket_id)
        .order_by(TicketInventoryAssetLink.linked_at)
    )).scalars().all()
    if not links:
        return []
    asset_ids = [l.asset_id for l in links]
    assets = (await db.execute(select(Asset).where(Asset.id.in_(asset_ids)))).scalars().all()
    asset_map = {a.id: a for a in assets}
    return [
        {"link_id": l.id, "asset_id": l.asset_id, "linked_at": l.linked_at,
         **{k: v for k, v in _clean(asset_map[l.asset_id].__dict__).items()
            if k in ("tag", "name", "asset_type", "status", "serial_number", "model", "manufacturer", "assigned_to", "assigned_name", "location")}}
        for l in links if l.asset_id in asset_map
    ]

@router.post("/{ticket_id}/inventory-assets/{asset_id}", status_code=201)
async def link_ticket_inventory_asset(ticket_id: int, asset_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    await _get_or_404(db, Ticket, ticket_id)
    await _get_or_404(db, Asset, asset_id)
    existing = (await db.execute(
        select(TicketInventoryAssetLink)
        .where(TicketInventoryAssetLink.ticket_id == ticket_id)
        .where(TicketInventoryAssetLink.asset_id == asset_id)
    )).scalar_one_or_none()
    if existing:
        return _clean(existing.__dict__)
    link = TicketInventoryAssetLink(ticket_id=ticket_id, asset_id=asset_id, linked_at=_now())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _clean(link.__dict__)

@router.delete("/{ticket_id}/inventory-assets/{asset_id}", status_code=204)
async def unlink_ticket_inventory_asset(ticket_id: int, asset_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    link = (await db.execute(
        select(TicketInventoryAssetLink)
        .where(TicketInventoryAssetLink.ticket_id == ticket_id)
        .where(TicketInventoryAssetLink.asset_id == asset_id)
    )).scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()

# ── Ticket Comments ───────────────────────────────────────────────────────────

@router.get("/{ticket_id}/comments")
async def list_comments(ticket_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at)
    )
    return [_clean(c.__dict__) for c in result.scalars()]

@router.post("/{ticket_id}/comments", status_code=201)
async def add_comment(ticket_id: int, body: CommentIn, request: Request, db: AsyncSession = Depends(get_db)):
    staff = _require_staff(request)
    t = await _get_or_404(db, Ticket, ticket_id)
    now = _now()
    # Mark first response
    if not body.is_internal and not t.first_response_at:
        t.first_response_at = now
    t.updated_at = now
    c = TicketComment(ticket_id=ticket_id, body=body.body, is_internal=body.is_internal,
                      author_staff_id=staff["id"], created_at=now)
    db.add(c)
    # Auto-move to in_progress on first external reply
    if t.status in ("open", "assigned") and not body.is_internal:
        t.status = "in_progress"
    await db.commit()
    await db.refresh(c)

    # Notify assigned agent of any new comment or internal note
    if t.assigned_to:
        await fire_ticket_notification(db, "ticket_commented", t, changed_by_id=staff["id"], is_internal=body.is_internal)
        await db.commit()

    # Notify @mentioned users via rule system (respects enable/disable + client overrides)
    # Combine explicitly selected IDs with text-based fallback scan
    mentioned_ids: set[str] = set(body.mentions)
    if body.body:
        all_users = (await db.execute(select(UserRecord))).scalars().all()
        for u in all_users:
            patterns = [u.name, u.first_name, u.email]
            for pat in patterns:
                if pat and f"@{pat.lower()}" in body.body.lower():
                    mentioned_ids.add(u.id)
                    break
    mentioned_ids.discard(staff["id"])  # never self-notify for own mention
    if mentioned_ids:
        await fire_ticket_notification(db, "ticket_mentioned", t, changed_by_id=staff["id"], mentioned_ids=list(mentioned_ids))
        await db.commit()

    broadcast("ticket_commented", {"ticket_id": ticket_id, "number": t.number})
    return _clean(c.__dict__)

@router.delete("/{ticket_id}/comments/{comment_id}", status_code=204)
async def delete_comment(ticket_id: int, comment_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    c = await _get_or_404(db, TicketComment, comment_id)
    if c.ticket_id != ticket_id:
        raise HTTPException(404)
    await db.delete(c)
    await db.commit()

# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/projects/list")
async def list_projects(customer_id: int | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(TicketProject).order_by(TicketProject.created_at.desc())
    if customer_id:
        stmt = stmt.where(TicketProject.customer_id == customer_id)
    result = await db.execute(stmt)
    projects = result.scalars().all()
    out = []
    for p in projects:
        task_count = (await db.execute(
            select(func.count(Ticket.id)).where(Ticket.project_id == p.id)
        )).scalar() or 0
        d = _clean(p.__dict__)
        d["task_count"] = task_count
        d["due_date"] = d.get("end_date")  # frontend alias
        out.append(d)
    return out

@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    now = _now()
    p = TicketProject(name=body.name, description=body.description,
                      customer_id=body.customer_id, priority=body.priority,
                      status=body.status,
                      start_date=body.start_date,
                      end_date=body.due_date or body.end_date,
                      manager_id=body.manager_id, created_at=now, updated_at=now)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _clean(p.__dict__)

@router.put("/projects/{project_id}")
async def update_project(project_id: int, body: ProjectIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    p = await _get_or_404(db, TicketProject, project_id)
    data = body.model_dump(exclude_none=True)
    if "due_date" in data:
        data["end_date"] = data.pop("due_date")
    for k, v in data.items():
        if hasattr(p, k):
            setattr(p, k, v)
    p.updated_at = _now()
    await db.commit()
    return _clean(p.__dict__)

@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    p = await _get_or_404(db, TicketProject, project_id)
    await db.delete(p)
    await db.commit()

# ── Change Requests ───────────────────────────────────────────────────────────

@router.put("/{ticket_id}/change", status_code=200)
async def update_change(ticket_id: int, body: ChangeUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    cr = (await db.execute(select(ChangeRequest).where(ChangeRequest.ticket_id == ticket_id))).scalar_one_or_none()
    if not cr:
        raise HTTPException(404, "No change request for this ticket")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(cr, k, v)
    if body.approval_status == "approved":
        staff = _require_staff(request)
        cr.approved_by = staff["id"]
        cr.approved_at = _now()
    await db.commit()
    return _clean(cr.__dict__)

class ApprovalPatch(BaseModel):
    approval_status: str

@router.patch("/change-requests/{cr_id}/approval", status_code=200)
async def patch_cr_approval(cr_id: int, body: ApprovalPatch, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    cr = (await db.execute(select(ChangeRequest).where(ChangeRequest.id == cr_id))).scalar_one_or_none()
    if not cr:
        raise HTTPException(404, "Change request not found")
    status = body.approval_status
    if status not in ("pending", "approved", "rejected"):
        raise HTTPException(422, "Invalid approval_status")
    cr.approval_status = status
    if status == "approved":
        staff = _require_staff(request)
        cr.approved_by = staff["id"]
        cr.approved_at = _now()
    else:
        cr.approved_by = None
        cr.approved_at = None
    await db.commit()
    return _clean(cr.__dict__)

# ── Problems ─────────────────────────────────────────────────────────────────

@router.put("/{ticket_id}/problem", status_code=200)
async def update_problem(ticket_id: int, body: ProblemUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    pr = (await db.execute(select(ProblemRecord).where(ProblemRecord.ticket_id == ticket_id))).scalar_one_or_none()
    if not pr:
        raise HTTPException(404, "No problem record for this ticket")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(pr, k, v)
    await db.commit()
    return _clean(pr.__dict__)

@router.post("/{ticket_id}/linked-tickets", status_code=200)
async def link_ticket_to_problem(ticket_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """Link an existing ticket to this problem by setting its problem_id."""
    _require_staff(request)
    body = await request.json()
    linked_id = body.get("ticket_id")
    if not linked_id:
        raise HTTPException(422, "ticket_id required")
    problem_ticket = await _get_or_404(db, Ticket, ticket_id)
    if problem_ticket.type != "problem":
        raise HTTPException(422, "Target ticket is not a problem")
    linked = await _get_or_404(db, Ticket, linked_id)
    linked.problem_id = ticket_id
    await db.commit()
    return _ticket_dict(linked)

@router.delete("/{ticket_id}/linked-tickets/{linked_id}", status_code=204)
async def unlink_ticket_from_problem(ticket_id: int, linked_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    linked = await _get_or_404(db, Ticket, linked_id)
    if linked.problem_id != ticket_id:
        raise HTTPException(404, "Ticket is not linked to this problem")
    linked.problem_id = None
    await db.commit()

@router.post("/{ticket_id}/assets", status_code=201)
async def add_problem_asset(ticket_id: int, body: ProblemAssetIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    t = await _get_or_404(db, Ticket, ticket_id)
    if t.type != "problem":
        raise HTTPException(422, "Assets can only be added to problem tickets")
    asset = ProblemAsset(
        ticket_id=ticket_id,
        asset_type=body.asset_type,
        asset_name=body.asset_name,
        asset_identifier=body.asset_identifier,
        device_record_id=body.device_record_id,
        added_at=_now(),
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return _clean(asset.__dict__)

@router.delete("/{ticket_id}/assets/{asset_id}", status_code=204)
async def remove_problem_asset(ticket_id: int, asset_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    asset = (await db.execute(
        select(ProblemAsset).where(ProblemAsset.id == asset_id, ProblemAsset.ticket_id == ticket_id)
    )).scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")
    await db.delete(asset)
    await db.commit()

# ── Groups ───────────────────────────────────────────────────────────────────

class GroupIn(BaseModel):
    name:        str
    description: str = ""
    color:       str = "#3b82f6"

@router.get("/groups")
async def list_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TicketGroup).order_by(TicketGroup.name))
    return [_clean(g.__dict__) for g in result.scalars()]

@router.post("/groups", status_code=201)
async def create_group(body: GroupIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    g = TicketGroup(name=body.name, description=body.description, color=body.color, created_at=_now())
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return _clean(g.__dict__)

@router.put("/groups/{group_id}")
async def update_group(group_id: int, body: GroupIn, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    g = await _get_or_404(db, TicketGroup, group_id)
    g.name = body.name; g.description = body.description; g.color = body.color
    await db.commit()
    return _clean(g.__dict__)

@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    g = await _get_or_404(db, TicketGroup, group_id)
    await db.delete(g)
    await db.commit()

# ── Attachments ───────────────────────────────────────────────────────────────

@router.post("/{ticket_id}/attachments", status_code=201)
async def upload_attachment(
    ticket_id: int, request: Request,
    file: UploadFile = File(...),
    comment_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    staff = _require_staff(request)
    await _get_or_404(db, Ticket, ticket_id)
    _UPLOADS.mkdir(parents=True, exist_ok=True)
    ext  = Path(file.filename).suffix if file.filename else ""
    name = f"{ticket_id}_{secrets.token_hex(8)}{ext}"
    dest = _UPLOADS / name
    with dest.open("wb") as fout:
        shutil.copyfileobj(file.file, fout)
    size = dest.stat().st_size
    att  = TicketAttachment(
        ticket_id=ticket_id, comment_id=comment_id,
        filename=f"ticket_attachments/{name}",
        original_name=file.filename or name, content_type=file.content_type,
        size=size, uploaded_at=_now(), uploaded_by=staff["id"],
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return _clean(att.__dict__)

@router.delete("/{ticket_id}/attachments/{att_id}", status_code=204)
async def delete_attachment(ticket_id: int, att_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    att = await _get_or_404(db, TicketAttachment, att_id)
    if att.ticket_id != ticket_id:
        raise HTTPException(404)
    try:
        (Path(__file__).parent.parent / "uploads" / att.filename).unlink(missing_ok=True)
    except Exception:
        pass
    await db.delete(att)
    await db.commit()

# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats/summary")
async def ticket_stats(customer_id: int | None = None, db: AsyncSession = Depends(get_db)):
    now        = datetime.now(timezone.utc).isoformat()
    today      = datetime.now(timezone.utc).date().isoformat()
    tomorrow   = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    ACTIVE = ["open", "assigned", "in_progress", "scheduled", "waiting_on_customer", "waiting_on_third_party", "pending", "escalated"]
    HOLD   = ["pending", "waiting_on_customer", "waiting_on_third_party"]

    base = select(func.count(Ticket.id)).where(Ticket.type.notin_(['task', 'project_task']))
    if customer_id:
        base = base.where(Ticket.customer_id == customer_id)

    async def cnt(*filters):
        s = base
        for f in filters:
            s = s.where(f)
        return (await db.execute(s)).scalar() or 0

    by_priority = {p: await cnt(Ticket.priority == p, Ticket.status.in_(ACTIVE)) for p in ("low", "medium", "high", "critical")}
    by_status   = {st: await cnt(Ticket.status == st) for st in ACTIVE}

    return {
        "open":              await cnt(Ticket.status.in_(["open", "assigned"])),
        "in_progress":       await cnt(Ticket.status.in_(["in_progress", "escalated", "scheduled"])),
        "pending":           await cnt(Ticket.status.in_(HOLD)),
        "on_hold":           await cnt(Ticket.status.in_(HOLD)),
        "resolved_today":    await cnt(Ticket.resolved_at >= today),
        "unassigned":        await cnt(Ticket.assigned_to == None, Ticket.status.in_(ACTIVE)),
        "sla_breached":      await cnt(Ticket.sla_resolve_due.isnot(None), Ticket.sla_resolve_due < now, Ticket.status.in_(ACTIVE)),
        "total":             await cnt(),
        "overdue":           await cnt(Ticket.due_date.isnot(None), Ticket.due_date < today, Ticket.status.in_(ACTIVE)),
        "due_today":         await cnt(Ticket.due_date.isnot(None), Ticket.due_date >= today, Ticket.due_date < tomorrow, Ticket.status.in_(ACTIVE)),
        "onboarding_month":  await cnt(func.lower(Ticket.title).contains("onboard"), Ticket.created_at >= month_start),
        "offboarding_month": await cnt(func.lower(Ticket.title).contains("offboard"), Ticket.created_at >= month_start),
        "by_priority": by_priority,
        "by_status":   by_status,
    }


@router.get("/stats/leaderboard")
async def ticket_leaderboard(customer_id: int | None = None, db: AsyncSession = Depends(get_db)):
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    def _apply_cust(stmt):
        return stmt.where(Ticket.customer_id == customer_id) if customer_id else stmt

    # Resolved this month per agent (exclude task types)
    resolved_stmt = _apply_cust(
        select(Ticket.assigned_to.label("agent_id"), func.count(Ticket.id).label("resolved"))
        .where(Ticket.assigned_to.isnot(None))
        .where(Ticket.status.in_(["resolved", "closed"]))
        .where(Ticket.resolved_at >= month_start)
        .where(Ticket.type.notin_(['task', 'project_task']))
        .group_by(Ticket.assigned_to)
    )
    resolved_rows = {r.agent_id: r.resolved for r in (await db.execute(resolved_stmt)).fetchall()}

    # Total handled (created/assigned) this month per agent (exclude task types)
    handled_stmt = _apply_cust(
        select(Ticket.assigned_to.label("agent_id"), func.count(Ticket.id).label("total"))
        .where(Ticket.assigned_to.isnot(None))
        .where(Ticket.created_at >= month_start)
        .where(Ticket.type.notin_(['task', 'project_task']))
        .group_by(Ticket.assigned_to)
    )
    handled_rows = {r.agent_id: r.total for r in (await db.execute(handled_stmt)).fetchall()}

    # All agents seen
    all_ids = set(resolved_rows) | set(handled_rows)
    if not all_ids:
        return []

    name_map = {}
    ur_rows = (await db.execute(select(UserRecord).where(UserRecord.id.in_(all_ids)))).scalars().all()
    for u in ur_rows:
        name_map[u.id] = (u.first_name + " " + u.last_name).strip() or u.email

    results = []
    for aid in all_ids:
        resolved = resolved_rows.get(aid, 0)
        handled  = handled_rows.get(aid, 0)
        results.append({
            "agent_id":     aid,
            "agent_name":   name_map.get(aid, aid.split("@")[0] if "@" in aid else aid),
            "resolved":     resolved,
            "total_handled": handled,
            "rate":         round(resolved / handled * 100) if handled else 0,
        })

    results.sort(key=lambda x: (-x["resolved"], -x["rate"]))
    return results[:10]

# ── System Settings ───────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = {
    "native_ticketing_enabled": False,
    "external_provider": None,
    "external_config": {},
    "sla_response_hr": 4,
    "sla_resolve_hr": 24,
    "auto_close_days": 7,
    "allow_portal_create": True,
    "priorities": ["low", "medium", "high", "critical"],
    "priority_matrix": _DEFAULT_MATRIX,
}

async def _get_settings(db: AsyncSession) -> dict:
    row = (await db.execute(select(TicketSystemConfig).where(TicketSystemConfig.id == 1))).scalar_one_or_none()
    if not row:
        return dict(_DEFAULT_SETTINGS)
    try:
        return {**_DEFAULT_SETTINGS, **json.loads(row.settings)}
    except Exception:
        return dict(_DEFAULT_SETTINGS)

@router.get("/system-settings")
async def get_system_settings(db: AsyncSession = Depends(get_db)):
    cfg = await _get_settings(db)
    cfg["statuses"] = TICKET_STATUSES   # always authoritative from server
    return cfg

@router.put("/system-settings")
async def save_system_settings(body: dict, request: Request, db: AsyncSession = Depends(get_db)):
    _require_staff(request)
    row = (await db.execute(select(TicketSystemConfig).where(TicketSystemConfig.id == 1))).scalar_one_or_none()
    if row:
        existing = json.loads(row.settings) if row.settings else {}
        existing.update(body)
        row.settings = json.dumps(existing)
    else:
        merged = {**_DEFAULT_SETTINGS, **body}
        row = TicketSystemConfig(id=1, settings=json.dumps(merged))
        db.add(row)
    await db.commit()
    return await _get_settings(db)


# ── Utilities ─────────────────────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, model, pk):
    obj = (await db.execute(select(model).where(model.id == pk))).scalar_one_or_none()
    if not obj:
        raise HTTPException(404, f"{model.__name__} {pk} not found")
    return obj

def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "_sa_instance_state"}

def _ticket_dict(t: Ticket) -> dict:
    d = _clean(t.__dict__)
    try:
        d["tags"] = json.loads(t.tags or "[]")
    except Exception:
        d["tags"] = []
    return d


async def _with_agent_name(d: dict, db: AsyncSession) -> dict:
    """Inject assigned_to_name by looking up the user record for the OID stored in assigned_to."""
    uid = d.get("assigned_to")
    if uid:
        row = (await db.execute(select(UserRecord).where(UserRecord.id == uid))).scalar_one_or_none()
        d["assigned_to_name"] = row.name if row else uid
    else:
        d["assigned_to_name"] = None
    return d


async def _with_agent_names(dicts: list[dict], db: AsyncSession) -> list[dict]:
    """Bulk-inject assigned_to_name for a list of ticket dicts (one DB query)."""
    ids = {d["assigned_to"] for d in dicts if d.get("assigned_to")}
    name_map: dict[str, str] = {}
    if ids:
        rows = (await db.execute(select(UserRecord).where(UserRecord.id.in_(ids)))).scalars().all()
        name_map = {r.id: r.name for r in rows}
    for d in dicts:
        uid = d.get("assigned_to")
        d["assigned_to_name"] = name_map.get(uid, uid) if uid else None
    return dicts
