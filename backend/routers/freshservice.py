import os
import base64
import httpx
import asyncio
from fastapi import APIRouter, HTTPException, Query, Request
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

router = APIRouter(prefix="/api/freshservice", tags=["freshservice"])

TICKET_STATUSES = {
    2: "Open",
    3: "Pending",
    4: "Resolved",
    5: "Closed",
    6: "Waiting on Customer",
    7: "Waiting on Third Party",
}

TICKET_PRIORITIES = {
    1: "Low",
    2: "Medium",
    3: "High",
    4: "Urgent",
}


def _get_config():
    domain = os.getenv("FRESHSERVICE_DOMAIN", "")
    api_key = os.getenv("FRESHSERVICE_API_KEY", "")
    if not domain or not api_key:
        raise HTTPException(
            status_code=503,
            detail="Freshservice credentials not configured. Set FRESHSERVICE_DOMAIN and FRESHSERVICE_API_KEY in .env",
        )
    return domain, api_key


def _auth_header(api_key: str) -> dict:
    token = base64.b64encode(f"{api_key}:X".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


@router.get("/tickets")
async def get_tickets_for_email(email: str = Query(..., min_length=1)):
    domain, api_key = _get_config()
    headers = _auth_header(api_key)

    # First resolve requester ID by email
    async with httpx.AsyncClient(timeout=15) as client:
        req_resp = await client.get(
            f"https://{domain}/api/v2/requesters",
            headers=headers,
            params={"email": email, "per_page": 1},
        )

    if req_resp.status_code >= 400:
        raise HTTPException(status_code=req_resp.status_code, detail=req_resp.text)

    requesters = req_resp.json().get("requesters", [])
    if not requesters:
        return {"tickets": [], "total": 0}

    requester_id = requesters[0]["id"]

    # Fetch tickets for requester, most recent first
    async with httpx.AsyncClient(timeout=15) as client:
        t_resp = await client.get(
            f"https://{domain}/api/v2/tickets",
            headers=headers,
            params={
                "requester_id": requester_id,
                "per_page": 30,
                "order_by": "created_at",
                "order_type": "desc",
                "include": "requester",
            },
        )

    if t_resp.status_code >= 400:
        raise HTTPException(status_code=t_resp.status_code, detail=t_resp.text)

    raw = t_resp.json().get("tickets", [])

    tickets = [
        {
            "id": t["id"],
            "subject": t.get("subject", "(No subject)"),
            "status": TICKET_STATUSES.get(t.get("status"), str(t.get("status"))),
            "priority": TICKET_PRIORITIES.get(t.get("priority"), str(t.get("priority"))),
            "created_at": t.get("created_at"),
            "updated_at": t.get("updated_at"),
            "type": t.get("type", ""),
            "url": f"https://{domain}/helpdesk/tickets/{t['id']}",
        }
        for t in raw
    ]

    return {"tickets": tickets, "total": len(tickets)}


async def _get_agent_id(domain: str, headers: dict, email: str) -> int | None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"https://{domain}/api/v2/agents",
            headers=headers,
            params={"email": email},
        )
    if r.status_code != 200:
        return None
    agents = r.json().get("agents", [])
    return agents[0]["id"] if agents else None


async def _fetch_all_tickets(domain: str, headers: dict, max_pages: int = 10) -> list[dict]:
    """Fetch all tickets by paginating. Freshservice on this instance doesn't support
    responder_id or filter=open as query params, so we scan all pages client-side."""
    async with httpx.AsyncClient(timeout=30) as client:
        # Fetch first page to see how many pages exist
        r = await client.get(
            f"https://{domain}/api/v2/tickets",
            headers=headers,
            params={"per_page": 100, "page": 1, "order_by": "updated_at", "order_type": "desc"},
        )
        if r.status_code != 200:
            return []
        first_page = r.json().get("tickets", [])
        if len(first_page) < 100:
            return first_page

        # Fetch remaining pages in parallel
        pages = await asyncio.gather(*[
            client.get(
                f"https://{domain}/api/v2/tickets",
                headers=headers,
                params={"per_page": 100, "page": p, "order_by": "updated_at", "order_type": "desc"},
            )
            for p in range(2, max_pages + 1)
        ])

        all_tickets = list(first_page)
        for resp in pages:
            if resp.status_code != 200:
                break
            batch = resp.json().get("tickets", [])
            all_tickets.extend(batch)
            if len(batch) < 100:
                break
        return all_tickets


@router.get("/stats")
async def get_ticket_stats(request: Request):
    domain, api_key = _get_config()
    headers = _auth_header(api_key)

    user       = getattr(request.state, "user", None)
    user_email = user.get("email") if user else None

    agent_id = await _get_agent_id(domain, headers, user_email) if user_email else None

    # Freshservice on this instance rejects responder_id and filter=open as params,
    # so we fetch all tickets and filter client-side.
    all_tickets = await _fetch_all_tickets(domain, headers)

    closed_statuses = {4, 5}

    def _my_open() -> int:
        if not agent_id:
            return 0
        return sum(
            1 for t in all_tickets
            if t.get("responder_id") == agent_id and t.get("status") not in closed_statuses
        )

    def _unassigned() -> int:
        return sum(
            1 for t in all_tickets
            if not t.get("responder_id") and t.get("status") not in closed_statuses
        )

    my_open, unassigned = _my_open(), _unassigned()

    return {"open": my_open, "pending": unassigned}


def _format_ticket(t: dict, domain: str) -> dict:
    return {
        "id":       t["id"],
        "subject":  t.get("subject", "(No subject)"),
        "status":   TICKET_STATUSES.get(t.get("status"), str(t.get("status"))),
        "priority": TICKET_PRIORITIES.get(t.get("priority"), str(t.get("priority"))),
        "created_at": t.get("created_at"),
        "updated_at": t.get("updated_at"),
        "requester_name": (t.get("requester") or {}).get("name", ""),
        "url": f"https://{domain}/helpdesk/tickets/{t['id']}",
    }


@router.get("/unassigned-tickets")
async def get_unassigned_tickets():
    """Return open tickets with no agent assigned."""
    domain, api_key = _get_config()
    headers = _auth_header(api_key)

    closed_statuses = {4, 5}
    all_tickets = await _fetch_all_tickets(domain, headers)

    raw = [
        t for t in all_tickets
        if not t.get("responder_id") and t.get("status") not in closed_statuses
    ]
    raw.sort(key=lambda t: t.get("updated_at", ""), reverse=True)

    return {"tickets": [_format_ticket(t, domain) for t in raw]}



AMS_SEVERITY = {
    51:  "OK",
    101: "Warning",
    151: "Error",
    201: "Critical",
}

AMS_STATE = {
    1: "Open",
    2: "Resolved",
    3: "Reopen",
}

# States to include: open (1) and reopen (3) — exclude resolved (2)
_AMS_OPEN_STATES = {1, 3}

_AMS_OPEN_QUERY = "state:1 OR state:3"


async def _fetch_ams_alerts(domain: str, headers: dict, max_pages: int = 20) -> list[dict]:
    """Fetch open/reopen AMS alerts using the filter API, paginating as needed."""
    params_base = {
        "query":      _AMS_OPEN_QUERY,
        "order_by":   "updated_at",
        "order_type": "desc",
        "per_page":   100,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"https://{domain}/api/v2/ams/alerts",
            headers=headers,
            params={**params_base, "page": 1},
        )
        if r.status_code != 200:
            return []
        first_page = r.json().get("alerts", [])
        if len(first_page) < 100:
            return first_page

        pages = await asyncio.gather(*[
            client.get(
                f"https://{domain}/api/v2/ams/alerts",
                headers=headers,
                params={**params_base, "page": p},
            )
            for p in range(2, max_pages + 1)
        ])

        all_alerts = list(first_page)
        for resp in pages:
            if resp.status_code != 200:
                break
            batch = resp.json().get("alerts", [])
            all_alerts.extend(batch)
            if len(batch) < 100:
                break
        return all_alerts


@router.get("/alerts")
async def get_open_alerts():
    """Return all open/reopen AMS alerts from Freshservice.

    Uses the /api/v2/ams/alerts filter endpoint with state:1 OR state:3
    to exclude resolved alerts. Severity and state are mapped from numeric codes.
    """
    domain, api_key = _get_config()
    headers = _auth_header(api_key)

    raw = await _fetch_ams_alerts(domain, headers)

    alerts = [
        {
            "id":              a["id"],
            "title":           a.get("subject") or a.get("resource") or "(No subject)",
            "resource":        a.get("resource", ""),
            "severity":        AMS_SEVERITY.get(a.get("severity"), str(a.get("severity", ""))),
            "state":           AMS_STATE.get(a.get("state"), str(a.get("state", ""))),
            "description":     a.get("description", ""),
            "created_at":      a.get("created_at"),
            "updated_at":      a.get("updated_at"),
            "occurrence_time": a.get("occurrence_time"),
            "url":             f"https://{domain}/itom/alerts/{a['id']}",
        }
        for a in raw
    ]

    return {"alerts": alerts, "total": len(alerts)}


@router.get("/my-tickets")
async def get_my_assigned_tickets(request: Request):
    """Return open tickets assigned to the currently authenticated agent."""
    domain, api_key = _get_config()
    headers = _auth_header(api_key)

    user       = getattr(request.state, "user", None)
    user_email = user.get("email") if user else None

    agent_id = await _get_agent_id(domain, headers, user_email) if user_email else None
    if not agent_id:
        return {"tickets": [], "agent_found": False}

    # filter=open and responder_id params are not supported on this instance —
    # fetch all tickets and filter client-side, same as /stats
    closed_statuses = {4, 5}
    all_tickets = await _fetch_all_tickets(domain, headers)

    raw = [
        t for t in all_tickets
        if t.get("responder_id") == agent_id and t.get("status") not in closed_statuses
    ]
    raw.sort(key=lambda t: t.get("updated_at", ""), reverse=True)

    return {
        "tickets":     [_format_ticket(t, domain) for t in raw],
        "agent_found": True,
    }


PROBLEM_STATUSES = {
    1: "Open",
    2: "Change Requested",
    3: "Closed",
}

PROBLEM_PRIORITIES = {
    1: "Low",
    2: "Medium",
    3: "High",
    4: "Urgent",
}


async def _fetch_all_problems(domain: str, headers: dict, max_pages: int = 20) -> list[dict]:
    """Paginate through all Freshservice problems (100 per page)."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"https://{domain}/api/v2/problems",
            headers=headers,
            params={"per_page": 100, "page": 1, "order_by": "updated_at", "order_type": "desc"},
        )
        if r.status_code != 200:
            return []
        first_page = r.json().get("problems", [])
        if len(first_page) < 100:
            return first_page

        pages = await asyncio.gather(*[
            client.get(
                f"https://{domain}/api/v2/problems",
                headers=headers,
                params={"per_page": 100, "page": p, "order_by": "updated_at", "order_type": "desc"},
            )
            for p in range(2, max_pages + 1)
        ])

        all_problems = list(first_page)
        for resp in pages:
            if resp.status_code != 200:
                break
            batch = resp.json().get("problems", [])
            all_problems.extend(batch)
            if len(batch) < 100:
                break
        return all_problems


@router.get("/open-problems")
async def get_open_problems():
    """Return all open Freshservice problems (status != Closed)."""
    domain, api_key = _get_config()
    headers = _auth_header(api_key)

    raw = await _fetch_all_problems(domain, headers)

    open_problems = [p for p in raw if p.get("status") != 3]

    problems = [
        {
            "id":          p["id"],
            "title":       p.get("subject", "(No subject)"),
            "priority":    PROBLEM_PRIORITIES.get(p.get("priority"), ""),
            "status":      PROBLEM_STATUSES.get(p.get("status"), str(p.get("status"))),
            "created_at":  p.get("created_at"),
            "updated_at":  p.get("updated_at"),
            "description": p.get("description_text", ""),
            "url":         f"https://{domain}/a/problems/{p['id']}",
        }
        for p in open_problems
    ]

    return {"problems": problems, "total": len(problems)}
