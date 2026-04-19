import os
import json
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Query
from sqlalchemy import select, func, or_

from ..database import AsyncSessionLocal
from ..models import DirectoryUser
from ..auth import get_graph_token, is_azure_configured

router = APIRouter(prefix="/api/directory", tags=["directory"])

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

DIR_SELECT = (
    "id,displayName,givenName,surname,mail,userPrincipalName,"
    "jobTitle,department,officeLocation,mobilePhone,"
    "businessPhones,usageLocation,accountEnabled,"
    "city,state,country,companyName,employeeId,employeeType"
)


def _norm_email(email: str) -> str:
    return (email or "").lower().strip()


# ── M365 fetch ────────────────────────────────────────────────────────────────

async def _fetch_m365_users() -> tuple[list[dict], str | None]:
    if not is_azure_configured():
        return [], None
    try:
        token   = get_graph_token()
        headers = {"Authorization": f"Bearer {token}"}
        users: list[dict] = []
        url = f"{GRAPH_BASE}/users"
        params = {"$select": DIR_SELECT, "$top": 999, "$filter": "userType eq 'Member'"}

        async with httpx.AsyncClient(timeout=60) as client:
            while url:
                r = await client.get(url, headers=headers, params=params if "?" not in url else None)
                if r.status_code >= 400:
                    return [], f"M365 API error {r.status_code}"
                data = r.json()
                users.extend(data.get("value", []))
                url = data.get("@odata.nextLink")

        return users, None
    except Exception as e:
        return [], f"M365: {str(e)}"


# ── Workday fetch (stub — implement when credentials are wired) ───────────────

async def _fetch_workday_users() -> tuple[list[dict], str | None]:
    tenant = os.environ.get("WORKDAY_TENANT", "").strip()
    client_id = os.environ.get("WORKDAY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("WORKDAY_CLIENT_SECRET", "").strip()
    if not (tenant and client_id and client_secret):
        return [], None
    # TODO: implement Workday RAAS or REST API user fetch
    # Expected shape per user: {id, email, workerType, status, hireDate, location, costCenter, managerEmail}
    return [], "Workday sync not yet implemented"


# ── Okta fetch ────────────────────────────────────────────────────────────────

async def _fetch_okta_users() -> tuple[list[dict], str | None]:
    domain    = os.environ.get("OKTA_DOMAIN", "").strip().rstrip("/").removeprefix("https://").removeprefix("http://")
    api_token = os.environ.get("OKTA_API_TOKEN", "").strip()
    if not (domain and api_token):
        return [], None
    try:
        headers = {"Authorization": f"SSWS {api_token}", "Accept": "application/json"}
        users: list[dict] = []
        url    = f"https://{domain}/api/v1/users"
        params = {"limit": 200}

        async with httpx.AsyncClient(timeout=60) as client:
            while url:
                r = await client.get(url, headers=headers, params=params if "?" not in url else None)
                if r.status_code >= 400:
                    return [], f"Okta API error {r.status_code}: {r.text[:200]}"
                users.extend(r.json())
                # Cursor-based pagination via Link header
                next_url = None
                for part in r.headers.get("Link", "").split(","):
                    if 'rel="next"' in part:
                        next_url = part.split(";")[0].strip().strip("<>")
                        break
                url = next_url

        return users, None
    except Exception as e:
        return [], f"Okta: {str(e)}"


# ── Upsert helper ─────────────────────────────────────────────────────────────

def _user_to_dict(u: DirectoryUser) -> dict:
    return {
        "id":           u.id,
        "email":        u.email,
        "display_name": u.display_name,
        "first_name":   u.first_name,
        "last_name":    u.last_name,
        "job_title":    u.job_title,
        "department":   u.department,
        "company":      u.company,
        "employee_id":  u.employee_id,
        "last_updated": u.last_updated,
        "m365": {
            "id":               u.m365_id,
            "upn":              u.m365_upn,
            "account_enabled":  u.m365_account_enabled,
            "office_location":  u.m365_office_location,
            "usage_location":   u.m365_usage_location,
            "mobile_phone":     u.m365_mobile_phone,
            "business_phones":  json.loads(u.m365_business_phones) if u.m365_business_phones else [],
            "employee_type":    u.m365_employee_type,
            "city":             u.m365_city,
            "state":            u.m365_state,
            "country":          u.m365_country,
            "licenses":         json.loads(u.m365_licenses) if u.m365_licenses else [],
            "synced_at":        u.m365_synced_at,
        } if u.m365_id else None,
        "workday": {
            "id":            u.workday_id,
            "worker_type":   u.workday_worker_type,
            "status":        u.workday_status,
            "hire_date":     u.workday_hire_date,
            "location":      u.workday_location,
            "cost_center":   u.workday_cost_center,
            "manager_email": u.workday_manager_email,
            "synced_at":     u.workday_synced_at,
        } if u.workday_id else None,
        "okta": {
            "id":               u.okta_id,
            "status":           u.okta_status,
            "login":            u.okta_login,
            "last_login":       u.okta_last_login,
            "password_changed": u.okta_password_changed,
            "mfa_enrolled":     u.okta_mfa_enrolled,
            "synced_at":        u.okta_synced_at,
        } if u.okta_id else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_directory():
    """Pull all users from M365 (+ Workday/Okta when configured) and upsert into directory_users."""
    now = datetime.now(timezone.utc).isoformat()

    m365_raw,    m365_err    = await _fetch_m365_users()
    workday_raw, workday_err = await _fetch_workday_users()
    okta_raw,    okta_err    = await _fetch_okta_users()

    # Index each source by normalized email
    m365_map:    dict[str, dict] = {}
    workday_map: dict[str, dict] = {}
    okta_map:    dict[str, dict] = {}

    for u in m365_raw:
        email = _norm_email(u.get("mail") or u.get("userPrincipalName") or "")
        if email:
            m365_map[email] = u

    for u in workday_raw:
        email = _norm_email(u.get("email") or "")
        if email:
            workday_map[email] = u

    for u in okta_raw:
        email = _norm_email((u.get("profile") or {}).get("email") or u.get("login") or "")
        if email:
            okta_map[email] = u

    all_emails = set(m365_map) | set(workday_map) | set(okta_map)

    async with AsyncSessionLocal() as session:
        for email in all_emails:
            m365    = m365_map.get(email)
            workday = workday_map.get(email)
            okta    = okta_map.get(email)

            # Resolve best-available common fields: M365 > Workday > Okta
            display_name = (
                (m365    and m365.get("displayName"))       or
                (workday and workday.get("displayName"))    or
                email
            )
            first_name = (
                (m365    and m365.get("givenName"))         or
                (workday and workday.get("firstName"))      or
                None
            )
            last_name = (
                (m365    and m365.get("surname"))           or
                (workday and workday.get("lastName"))       or
                None
            )
            job_title = (
                (m365    and m365.get("jobTitle"))          or
                (workday and workday.get("jobTitle"))       or
                None
            )
            department = (
                (m365    and m365.get("department"))        or
                (workday and workday.get("department"))     or
                None
            )
            company = (
                (m365    and m365.get("companyName"))       or
                (workday and workday.get("company"))        or
                None
            )
            employee_id = (
                (m365    and m365.get("employeeId"))        or
                (workday and workday.get("employeeId"))     or
                None
            )

            existing = (await session.execute(
                select(DirectoryUser).where(DirectoryUser.email == email)
            )).scalar_one_or_none()

            if not existing:
                existing = DirectoryUser(email=email)
                session.add(existing)

            existing.display_name = display_name
            existing.first_name   = first_name
            existing.last_name    = last_name
            existing.job_title    = job_title
            existing.department   = department
            existing.company      = company
            existing.employee_id  = employee_id
            existing.last_updated = now

            if m365:
                existing.m365_id              = m365.get("id")
                existing.m365_upn             = m365.get("userPrincipalName")
                existing.m365_account_enabled = m365.get("accountEnabled")
                existing.m365_office_location = m365.get("officeLocation")
                existing.m365_usage_location  = m365.get("usageLocation")
                existing.m365_mobile_phone    = m365.get("mobilePhone")
                existing.m365_business_phones = json.dumps(m365.get("businessPhones") or [])
                existing.m365_employee_type   = m365.get("employeeType")
                existing.m365_city            = m365.get("city")
                existing.m365_state           = m365.get("state")
                existing.m365_country         = m365.get("country")
                existing.m365_licenses        = json.dumps([])   # fetched separately if needed
                existing.m365_synced_at       = now

            if workday:
                existing.workday_id            = workday.get("id")
                existing.workday_worker_type   = workday.get("workerType")
                existing.workday_status        = workday.get("status")
                existing.workday_hire_date     = workday.get("hireDate")
                existing.workday_location      = workday.get("location")
                existing.workday_cost_center   = workday.get("costCenter")
                existing.workday_manager_email = workday.get("managerEmail")
                existing.workday_synced_at     = now

            if okta:
                profile = okta.get("profile") or {}
                existing.okta_id               = okta.get("id")
                existing.okta_status           = okta.get("status")
                existing.okta_login            = profile.get("login") or okta.get("login")
                existing.okta_last_login       = okta.get("lastLogin")
                existing.okta_password_changed = okta.get("passwordChanged")
                existing.okta_mfa_enrolled     = None   # requires separate /factors API call
                existing.okta_synced_at        = now

        await session.commit()

    errors = [e for e in [m365_err, workday_err, okta_err] if e]
    return {
        "synced":       len(all_emails),
        "m365_count":   len(m365_map),
        "workday_count": len(workday_map),
        "okta_count":   len(okta_map),
        "errors":       errors,
    }


@router.get("/users")
async def list_directory_users(
    q:      str | None = Query(default=None),
    source: str | None = Query(default=None),   # "m365" | "workday" | "okta"
    limit:  int        = Query(default=500, le=2000),
    offset: int        = Query(default=0),
):
    async with AsyncSessionLocal() as session:
        stmt = select(DirectoryUser)

        if q:
            ql = f"%{q.lower()}%"
            stmt = stmt.where(or_(
                func.lower(DirectoryUser.display_name).like(ql),
                func.lower(DirectoryUser.email).like(ql),
                func.lower(DirectoryUser.job_title).like(ql),
                func.lower(DirectoryUser.department).like(ql),
                func.lower(DirectoryUser.employee_id).like(ql),
            ))
        if source == "m365":
            stmt = stmt.where(DirectoryUser.m365_id.isnot(None))
        elif source == "workday":
            stmt = stmt.where(DirectoryUser.workday_id.isnot(None))
        elif source == "okta":
            stmt = stmt.where(DirectoryUser.okta_id.isnot(None))

        total = (await session.execute(
            select(func.count()).select_from(stmt.subquery())
        )).scalar() or 0

        rows = (await session.execute(
            stmt.order_by(DirectoryUser.display_name).offset(offset).limit(limit)
        )).scalars().all()

    return {"total": total, "users": [_user_to_dict(u) for u in rows]}


@router.get("/users/{user_id}")
async def get_directory_user(user_id: int):
    async with AsyncSessionLocal() as session:
        row = (await session.execute(
            select(DirectoryUser).where(DirectoryUser.id == user_id)
        )).scalar_one_or_none()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    return _user_to_dict(row)
