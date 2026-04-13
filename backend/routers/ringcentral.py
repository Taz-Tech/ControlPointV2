import os
import time
import asyncio
import base64
import httpx
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import UserRecord

router = APIRouter(prefix="/api/ringcentral", tags=["ringcentral"])

RC_PRODUCTION_URL = "https://platform.ringcentral.com"

# ── In-memory cache ───────────────────────────────────────────────────────────

# RC OAuth token (cached to its actual expiry)
_rc_token_value:   str | None = None
_rc_token_expires: float = 0.0

# Presence snapshot shared across all users (45-second TTL)
_presence_data:    dict | None = None
_presence_expires: float = 0.0
_presence_lock:    asyncio.Lock | None = None   # created lazily inside event loop

RC_PRESENCE_TTL = 45  # seconds


def _get_presence_lock() -> asyncio.Lock:
    global _presence_lock
    if _presence_lock is None:
        _presence_lock = asyncio.Lock()
    return _presence_lock


def _invalidate_presence_cache() -> None:
    global _presence_data, _presence_expires
    _presence_data = None
    _presence_expires = 0.0


def _cfg():
    return {
        "client_id":     os.getenv("RC_CLIENT_ID", ""),
        "client_secret": os.getenv("RC_CLIENT_SECRET", ""),
        "jwt":           os.getenv("RC_JWT", ""),
        "server_url":    os.getenv("RC_SERVER_URL", RC_PRODUCTION_URL).rstrip("/"),
    }


def is_ringcentral_configured() -> bool:
    c = _cfg()
    return all([c["client_id"], c["client_secret"], c["jwt"]])


async def _get_rc_token() -> str:
    global _rc_token_value, _rc_token_expires

    if _rc_token_value and time.monotonic() < _rc_token_expires:
        return _rc_token_value

    c = _cfg()
    if not is_ringcentral_configured():
        raise HTTPException(status_code=503, detail="RingCentral is not configured.")

    credentials = base64.b64encode(
        f"{c['client_id']}:{c['client_secret']}".encode()
    ).decode()

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{c['server_url']}/restapi/oauth/token",
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content=(
                "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer"
                f"&assertion={c['jwt']}"
            ),
        )

    if r.status_code != 200:
        detail = r.json().get("error_description", r.text[:200])
        raise HTTPException(status_code=503, detail=f"RingCentral auth failed: {detail}")

    data = r.json()
    _rc_token_value   = data["access_token"]
    # Cache for actual token lifetime minus a 60-second safety buffer
    _rc_token_expires = time.monotonic() + max(data.get("expires_in", 3600) - 60, 60)
    return _rc_token_value


async def _fetch_presence(
    client: httpx.AsyncClient, base: str, headers: dict, ext_id: str
) -> dict | None:
    """Fetch presence for one extension. Returns None on error."""
    try:
        r = await client.get(
            f"{base}/restapi/v1.0/account/~/extension/{ext_id}/presence",
            headers=headers,
            params={"detailedTelephonyState": "true"},
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


async def _fetch_extension(
    client: httpx.AsyncClient, base: str, headers: dict, ext_id: str
) -> dict | None:
    """Fetch extension info (for department) for one extension. Returns None on error."""
    try:
        r = await client.get(
            f"{base}/restapi/v1.0/account/~/extension/{ext_id}",
            headers=headers,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


def _resolve_status(p: dict) -> dict:
    """Normalise RC presence fields into a simple status + color."""
    if not p:
        return {"status": "Offline", "color": "gray"}

    dnd       = p.get("dndStatus",      "TakeAllCalls")
    telephony = p.get("telephonyStatus", "NoCall")
    presence  = p.get("presenceStatus",  "Offline")
    user_st   = p.get("userStatus",      "Offline")

    if presence == "Offline":
        return {"status": "Offline", "color": "gray"}
    if telephony in ("CallConnected", "Ringing", "OnHold", "ParkedCall"):
        return {"status": "On Call", "color": "blue"}
    if dnd == "DoNotAcceptAnyCalls":
        return {"status": "DND", "color": "red"}
    if presence == "Busy" or user_st == "Busy":
        return {"status": "Busy", "color": "amber"}
    return {"status": "Available", "color": "green"}


class PresenceUpdate(BaseModel):
    dnd_status: str              # TakeAllCalls | DoNotAcceptAnyCalls
    user_status: str | None = None   # Available | Busy | Offline


async def _fetch_presence_data(db: AsyncSession) -> dict:
    """
    Performs all outbound RC API calls and builds the full presence response.
    Called at most once per RC_PRESENCE_TTL seconds regardless of how many
    users are polling the page simultaneously.
    """
    # ── 1. Query portal users with an RC extension ID ─────────────────────────
    result = await db.execute(
        select(UserRecord).where(
            UserRecord.rc_extension_id.isnot(None),
            UserRecord.rc_extension_id != "",
        )
    )
    portal_users = result.scalars().all()

    if not portal_users:
        return {
            "departments": [],
            "totals": {"total": 0, "available": 0, "busy": 0, "on_call": 0, "dnd": 0, "offline": 0},
            "no_users_configured": True,
        }

    # ── 2. Fetch presence + extension info concurrently ───────────────────────
    token = await _get_rc_token()
    c = _cfg()
    base = c["server_url"]
    headers = {"Authorization": f"Bearer {token}"}
    sem = asyncio.Semaphore(15)

    async def fetch_pair(ext_id: str):
        async with sem:
            async with httpx.AsyncClient(timeout=20) as client:
                presence, ext_info = await asyncio.gather(
                    _fetch_presence(client, base, headers, ext_id),
                    _fetch_extension(client, base, headers, ext_id),
                )
        return presence, ext_info

    pairs = await asyncio.gather(*[fetch_pair(u.rc_extension_id) for u in portal_users])

    # ── 3. Build department groups ─────────────────────────────────────────────
    departments: dict[str, dict] = {}

    for portal_user, (presence, ext_info) in zip(portal_users, pairs):
        resolved = _resolve_status(presence or {})
        dept_name = (
            (ext_info or {}).get("department", "").strip()
            or "Unassigned"
        )
        ext_number = (ext_info or {}).get("extensionNumber", portal_user.rc_extension_id)

        user = {
            "id":               portal_user.rc_extension_id,
            "portal_id":        portal_user.id,
            "name":             portal_user.name,
            "email":            portal_user.email,
            "extension":        ext_number,
            "department":       dept_name,
            "status":           resolved["status"],
            "status_color":     resolved["color"],
            "dnd_status":       (presence or {}).get("dndStatus",      "TakeAllCalls"),
            "presence_status":  (presence or {}).get("presenceStatus",  "Offline"),
            "telephony_status": (presence or {}).get("telephonyStatus", "NoCall"),
            "user_status":      (presence or {}).get("userStatus",      "Offline"),
        }

        if dept_name not in departments:
            departments[dept_name] = {"name": dept_name, "users": []}
        departments[dept_name]["users"].append(user)

    def dept_sort_key(d):
        return (1 if d["name"] == "Unassigned" else 0, d["name"].lower())

    dept_list = sorted(departments.values(), key=dept_sort_key)
    for dept in dept_list:
        dept["users"].sort(key=lambda u: u["name"].lower())

    all_users = [u for d in dept_list for u in d["users"]]
    totals = {
        "total":     len(all_users),
        "available": sum(1 for u in all_users if u["status"] == "Available"),
        "busy":      sum(1 for u in all_users if u["status"] == "Busy"),
        "on_call":   sum(1 for u in all_users if u["status"] == "On Call"),
        "dnd":       sum(1 for u in all_users if u["status"] == "DND"),
        "offline":   sum(1 for u in all_users if u["status"] == "Offline"),
    }

    return {"departments": dept_list, "totals": totals}


@router.get("/presence")
async def get_presence(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Return presence for all portal users who have an rc_extension_id configured,
    grouped by their RingCentral department.
    Requires admin role or explicit rc_presence_access grant.
    Results are cached for RC_PRESENCE_TTL seconds and shared across all callers.
    """
    global _presence_data, _presence_expires

    if not is_ringcentral_configured():
        raise HTTPException(status_code=503, detail="RingCentral is not configured.")

    # ── Permission check (always per-request, never cached) ───────────────────
    caller = getattr(request.state, "user", None)
    if not caller or not caller.get("id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    caller_result = await db.execute(select(UserRecord).where(UserRecord.id == caller["id"]))
    caller_record = caller_result.scalar_one_or_none()
    if not caller_record:
        raise HTTPException(status_code=403, detail="Access denied")
    if caller_record.role != "admin" and not caller_record.rc_presence_access:
        raise HTTPException(status_code=403, detail="You don't have access to RC Presence.")

    # ── Fast path: serve cached snapshot ──────────────────────────────────────
    if _presence_data is not None and time.monotonic() < _presence_expires:
        return _presence_data

    # ── Slow path: one fetch, all concurrent callers wait on the same lock ────
    async with _get_presence_lock():
        # Re-check after acquiring lock — another coroutine may have just populated it
        if _presence_data is not None and time.monotonic() < _presence_expires:
            return _presence_data

        data = await _fetch_presence_data(db)
        _presence_data    = data
        _presence_expires = time.monotonic() + RC_PRESENCE_TTL
        return data


async def _do_update_presence(extension_id: str, body: PresenceUpdate) -> dict:
    """Shared logic for updating presence by extension ID."""
    token = await _get_rc_token()
    c = _cfg()
    base = c["server_url"]

    update_body: dict = {"dndStatus": body.dnd_status}
    if body.user_status:
        update_body["userStatus"] = body.user_status

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.put(
            f"{base}/restapi/v1.0/account/~/extension/{extension_id}/presence",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=update_body,
        )

    if r.status_code >= 400:
        raise HTTPException(
            status_code=r.status_code,
            detail=f"Failed to update presence: {r.text[:200]}",
        )

    # Stale snapshot no longer reflects reality — drop it so next poll fetches fresh
    _invalidate_presence_cache()
    return r.json()


@router.put("/presence/{extension_id}")
async def update_presence(
    extension_id: str,
    body: PresenceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update DND / availability for a user. Requires admin or rc_presence_access."""
    caller = getattr(request.state, "user", None)
    if not caller or not caller.get("id"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    caller_result = await db.execute(select(UserRecord).where(UserRecord.id == caller["id"]))
    caller_record = caller_result.scalar_one_or_none()
    if not caller_record or (caller_record.role != "admin" and not caller_record.rc_presence_access):
        raise HTTPException(status_code=403, detail="You don't have permission to change user status.")
    return await _do_update_presence(extension_id, body)


@router.get("/me/presence")
async def get_my_presence(request: Request, db: AsyncSession = Depends(get_db)):
    """Return the calling user's own RC presence status."""
    user = getattr(request.state, "user", None)
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(UserRecord).where(UserRecord.id == user["id"]))
    record = result.scalar_one_or_none()

    if not record or not record.rc_extension_id:
        return {"rc_extension_id": None, "status": None}

    if not is_ringcentral_configured():
        return {"rc_extension_id": record.rc_extension_id, "status": None}

    token = await _get_rc_token()
    c = _cfg()
    base = c["server_url"]
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=15) as client:
        p = await _fetch_presence(client, base, headers, record.rc_extension_id)

    resolved = _resolve_status(p or {})
    return {
        "rc_extension_id": record.rc_extension_id,
        "status":          resolved["status"],
        "dnd_status":      (p or {}).get("dndStatus",      "TakeAllCalls"),
        "user_status":     (p or {}).get("userStatus",     "Available"),
        "presence_status": (p or {}).get("presenceStatus", "Offline"),
    }


@router.put("/me/presence")
async def update_my_presence(
    body: PresenceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update the calling user's own RC presence status."""
    user = getattr(request.state, "user", None)
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(UserRecord).where(UserRecord.id == user["id"]))
    record = result.scalar_one_or_none()

    if not record or not record.rc_extension_id:
        raise HTTPException(status_code=404, detail="No RingCentral Extension ID linked to your profile.")

    return await _do_update_presence(record.rc_extension_id, body)
