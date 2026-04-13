import os
import time
import asyncio
import httpx
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Query
from .logitech_sync import _get_all_places as _get_logitech_rooms, is_logitech_configured, _make_client as _logitech_client, LOGITECH_API_BASE, _cfg as _logitech_cfg, _shape_device

router = APIRouter(prefix="/api/conference-rooms", tags=["conference-rooms"])

# ── In-memory cache ───────────────────────────────────────────────────────────

# M365 OAuth token (cached to its actual expiry)
_m365_token_value:   str | None = None
_m365_token_expires: float = 0.0

# Room listing cache: date string ("YYYY-MM-DD") → (response_dict, expires_at)
_rooms_cache: dict[str, tuple[dict, float]] = {}
_rooms_locks: dict[str, asyncio.Lock] = {}   # per-date lock, created lazily

ROOMS_TTL = 180  # 3 minutes


def _get_rooms_lock(date_key: str) -> asyncio.Lock:
    if date_key not in _rooms_locks:
        _rooms_locks[date_key] = asyncio.Lock()
    return _rooms_locks[date_key]

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Rooms hidden from the UI (case-insensitive substring match on display name)
_HIDDEN_ROOM_SUBSTRINGS = [
    "boerne",
    "it_test",
    "mother",
]


def _is_hidden(name: str) -> bool:
    n = (name or "").lower()
    return any(s in n for s in _HIDDEN_ROOM_SUBSTRINGS)


# ── M365 auth ─────────────────────────────────────────────────────────────────

def _m365_cfg():
    return {
        "tenant_id":     os.getenv("AZURE_TENANT_ID", "").strip(),
        "client_id":     os.getenv("AZURE_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("AZURE_CLIENT_SECRET", "").strip(),
    }


def is_m365_configured() -> bool:
    c = _m365_cfg()
    return all([c["tenant_id"], c["client_id"], c["client_secret"]])


async def _get_m365_token() -> str:
    global _m365_token_value, _m365_token_expires

    if _m365_token_value and time.monotonic() < _m365_token_expires:
        return _m365_token_value

    c = _m365_cfg()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"https://login.microsoftonline.com/{c['tenant_id']}/oauth2/v2.0/token",
            data={
                "client_id":     c["client_id"],
                "client_secret": c["client_secret"],
                "scope":         "https://graph.microsoft.com/.default",
                "grant_type":    "client_credentials",
            },
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Failed to acquire M365 token: {r.text[:200]}")

    data = r.json()
    _m365_token_value   = data["access_token"]
    # Cache for actual token lifetime minus a 60-second safety buffer
    _m365_token_expires = time.monotonic() + max(data.get("expires_in", 3600) - 60, 60)
    return _m365_token_value


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize(name: str) -> str:
    """Lowercase, strip punctuation/whitespace for fuzzy name matching."""
    if not name:
        return ""
    import re
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _availability_status(events: list[dict], now: datetime) -> dict:
    """Derive current status and next-event info from a list of calendar events."""
    current = None
    upcoming = None

    for ev in events:
        start = _parse_dt(ev.get("start", {}).get("dateTime"))
        end   = _parse_dt(ev.get("end",   {}).get("dateTime"))
        if start is None or end is None:
            continue
        if start <= now < end:
            current = ev
        elif start > now and (upcoming is None or start < _parse_dt(upcoming["start"]["dateTime"])):
            upcoming = ev

    if current:
        status = "in_use"
        label  = "In Use"
    elif upcoming and (_parse_dt(upcoming["start"]["dateTime"]) - now) <= timedelta(minutes=30):
        status = "starting_soon"
        label  = "Starting Soon"
    else:
        status = "available"
        label  = "Available"

    return {
        "status":        status,
        "label":         label,
        "currentEvent":  _shape_event(current)  if current  else None,
        "upcomingEvent": _shape_event(upcoming) if upcoming else None,
    }


def _parse_dt(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _utc_marker(dt_str: str | None) -> str | None:
    """Append Z to bare datetime strings returned by Graph so browsers parse them as UTC."""
    if not dt_str:
        return None
    # Already has timezone info (Z, +00:00, etc.)
    if dt_str.endswith("Z") or "+" in dt_str[10:] or dt_str[19:20] in ("+", "-"):
        return dt_str
    return dt_str + "Z"


def _shape_event(ev: dict | None) -> dict | None:
    if not ev:
        return None
    return {
        "subject":   ev.get("subject", "Busy"),
        "organizer": (ev.get("organizer") or {}).get("emailAddress", {}).get("name"),
        "start":     _utc_marker(ev.get("start", {}).get("dateTime")),
        "end":       _utc_marker(ev.get("end",   {}).get("dateTime")),
        "isPrivate": ev.get("sensitivity") in ("private", "confidential"),
    }


def _shape_m365_room(r: dict) -> dict:
    return {
        "id":           r.get("id"),
        "email":        r.get("emailAddress"),
        "name":         r.get("displayName"),
        "building":     r.get("building"),
        "floor":        r.get("floorLabel") or r.get("floorNumber"),
        "capacity":     r.get("capacity"),
        "phone":        r.get("phone"),
        "isWheelChairAccessible": r.get("isWheelChairAccessible", False),
        "tags":         r.get("tags", []),
    }


# ── Data fetchers ─────────────────────────────────────────────────────────────

async def _fetch_m365_rooms(token: str) -> tuple[list[dict], str | None]:
    """
    Try the Places API first. If the app lacks Place.Read.All, fall back to
    manually configured room emails in CONFERENCE_ROOM_EMAILS env var.
    Returns (rooms, error_hint_or_none).
    """
    headers = {"Authorization": f"Bearer {token}"}

    # ── Attempt 1: Places API ─────────────────────────────────────────────────
    rooms = []
    url   = f"{GRAPH_BASE}/places/microsoft.graph.room"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                r = await client.get(url, headers=headers, params={"$top": 100} if "?" not in url else {})
                if r.status_code in (401, 403):
                    break   # fall through to manual fallback
                if r.status_code >= 400:
                    raise HTTPException(status_code=r.status_code, detail=f"Graph places error: {r.text[:200]}")
                data = r.json()
                rooms.extend(data.get("value", []))
                url = data.get("@odata.nextLink")
        if rooms:
            return rooms, None
    except HTTPException:
        raise
    except Exception:
        pass

    # ── Attempt 2: Manually configured room emails ────────────────────────────
    raw_emails = os.getenv("CONFERENCE_ROOM_EMAILS", "").strip()
    if raw_emails:
        manual_rooms = []
        for email in [e.strip() for e in raw_emails.split(",") if e.strip()]:
            manual_rooms.append({
                "id":           email,
                "emailAddress": email,
                "displayName":  email.split("@")[0].replace(".", " ").replace("-", " ").title(),
                "building":     None,
                "floorLabel":   None,
                "capacity":     None,
                "phone":        None,
                "isWheelChairAccessible": False,
                "tags":         [],
            })
        hint = None if manual_rooms else (
            "Place.Read.All permission not granted and CONFERENCE_ROOM_EMAILS is not set. "
            "Add Place.Read.All to your Azure app OR set CONFERENCE_ROOM_EMAILS=room1@domain.com,room2@domain.com in .env."
        )
        return manual_rooms, hint

    return [], (
        "No rooms found. Grant Place.Read.All to your Azure app registration for automatic discovery, "
        "or set CONFERENCE_ROOM_EMAILS=room1@domain.com,room2@domain.com in .env as a fallback."
    )


async def _fetch_room_schedule(token: str, room_email: str, date: datetime) -> list[dict]:
    """Fetch calendar events for a room for the given day."""
    start = date.replace(hour=0, minute=0, second=0, microsecond=0)
    end   = start + timedelta(days=1)

    fmt = "%Y-%m-%dT%H:%M:%S"
    headers = {
        "Authorization": f"Bearer {token}",
        "Prefer": 'outlook.timezone="UTC"',
    }

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{GRAPH_BASE}/users/{room_email}/calendarView",
            headers=headers,
            params={
                "startDateTime": start.strftime(fmt),
                "endDateTime":   end.strftime(fmt),
                "$select":       "subject,start,end,organizer,sensitivity,showAs",
                "$orderby":      "start/dateTime",
                "$top":          50,
            },
        )

    if r.status_code == 404:
        return []
    if r.status_code >= 400:
        return []

    return r.json().get("value", [])




# ── Routes ────────────────────────────────────────────────────────────────────

async def _fetch_rooms_data(date_key: str, target: datetime) -> dict:
    """
    Performs all outbound M365 + Logitech API calls and builds the full room response.
    Called at most once per ROOMS_TTL seconds per date regardless of concurrent callers.
    """
    now = datetime.now(timezone.utc)
    token = await _get_m365_token()

    async def _safe_logitech_rooms():
        try:
            return await _get_logitech_rooms(), None
        except HTTPException as e:
            return [], e.detail
        except Exception as e:
            return [], str(e)

    (m365_rooms_raw, rooms_hint), (logitech_rooms_raw, logitech_error) = await asyncio.gather(
        _fetch_m365_rooms(token),
        _safe_logitech_rooms() if is_logitech_configured() else asyncio.sleep(0, result=([], None)),
    )

    # Build Logitech lookup by normalized name
    logitech_by_name: dict[str, dict] = {}
    for lr in logitech_rooms_raw:
        key = _normalize(lr.get("name") or "")
        if key:
            logitech_by_name[key] = lr

    shaped_rooms = [
        _shape_m365_room(r) for r in m365_rooms_raw
        if not _is_hidden(r.get("displayName") or "")
    ]

    async def _enrich(room: dict) -> dict:
        events = await _fetch_room_schedule(token, room["email"], target)
        avail  = _availability_status(events, now)

        logitech_room = logitech_by_name.get(_normalize(room["name"] or ""))
        logitech_devices = []
        if logitech_room:
            raw_devices = logitech_room.get("devices") or []
            logitech_devices = [
                _shape_device(d, logitech_room.get("id", ""), logitech_room.get("name", ""))
                for d in raw_devices
            ]

        return {
            **room,
            "availability":      avail["status"],
            "availabilityLabel": avail["label"],
            "currentEvent":      avail["currentEvent"],
            "upcomingEvent":     avail["upcomingEvent"],
            "todayEvents":       [_shape_event(e) for e in events],
            "logitech": {
                "matched":  logitech_room is not None,
                "roomId":   (logitech_room or {}).get("id"),
                "devices":  logitech_devices,
            },
        }

    results = []
    BATCH = 20
    for i in range(0, len(shaped_rooms), BATCH):
        batch = await asyncio.gather(*[_enrich(r) for r in shaped_rooms[i:i+BATCH]])
        results.extend(batch)

    results.sort(key=lambda r: (r.get("building") or "", r.get("floor") or "", r["name"] or ""))

    return {
        "date":              date_key,
        "total":             len(results),
        "available":         sum(1 for r in results if r["availability"] == "available"),
        "inUse":             sum(1 for r in results if r["availability"] == "in_use"),
        "startingSoon":      sum(1 for r in results if r["availability"] == "starting_soon"),
        "logitechConnected": is_logitech_configured(),
        "logitechError":     logitech_error,
        "roomsHint":         rooms_hint,
        "rooms":             results,
    }


@router.get("/")
async def list_conference_rooms(date: str | None = Query(default=None, description="Date in YYYY-MM-DD format, defaults to today")):
    """
    Returns all conference rooms with today's availability status and Logitech equipment.
    Results are cached for ROOMS_TTL seconds and shared across all callers.
    """
    if not is_m365_configured():
        raise HTTPException(status_code=503, detail="Microsoft 365 credentials not configured.")

    if date:
        try:
            target = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        target = datetime.now(timezone.utc)

    date_key = target.strftime("%Y-%m-%d")

    # ── Fast path: serve cached snapshot ──────────────────────────────────────
    cached = _rooms_cache.get(date_key)
    if cached and time.monotonic() < cached[1]:
        return cached[0]

    # ── Slow path: one fetch per date, concurrent callers wait on the same lock ─
    async with _get_rooms_lock(date_key):
        # Re-check after acquiring lock
        cached = _rooms_cache.get(date_key)
        if cached and time.monotonic() < cached[1]:
            return cached[0]

        data = await _fetch_rooms_data(date_key, target)
        _rooms_cache[date_key] = (data, time.monotonic() + ROOMS_TTL)
        return data


@router.get("/{room_email}/schedule")
async def get_room_schedule(
    room_email: str,
    date: str | None = Query(default=None, description="Date in YYYY-MM-DD format, defaults to today"),
):
    """Get the full day schedule for a single room."""
    if not is_m365_configured():
        raise HTTPException(status_code=503, detail="Microsoft 365 credentials not configured.")

    if date:
        try:
            target = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        target = datetime.now(timezone.utc)

    token  = await _get_m365_token()
    events = await _fetch_room_schedule(token, room_email, target)

    return {
        "email":  room_email,
        "date":   target.strftime("%Y-%m-%d"),
        "events": [_shape_event(e) for e in events],
    }
