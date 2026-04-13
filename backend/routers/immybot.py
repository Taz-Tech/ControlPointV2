import os
import time
import asyncio
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/immybot", tags=["immybot"])

# ── In-memory cache ───────────────────────────────────────────────────────────

# ImmyBot OAuth token
_immy_token_value:   str | None = None
_immy_token_expires: float = 0.0

# Full paginated computer list — shared by device search, user lookup, and stats
_computers_cache:   list[dict] | None = None
_computers_expires: float = 0.0
_computers_lock:    asyncio.Lock | None = None

COMPUTERS_TTL = 90  # seconds


def _get_computers_lock() -> asyncio.Lock:
    global _computers_lock
    if _computers_lock is None:
        _computers_lock = asyncio.Lock()
    return _computers_lock


def _cfg():
    return {
        "base_url": os.getenv("IMMYBOT_BASE_URL", "").rstrip("/"),
        "client_id": os.getenv("IMMYBOT_CLIENT_ID", ""),
        "client_secret": os.getenv("IMMYBOT_CLIENT_SECRET", ""),
        "tenant_id": os.getenv("IMMYBOT_TENANT_ID", ""),
        "app_id": os.getenv("IMMYBOT_APP_ID", ""),
    }


def is_immybot_configured() -> bool:
    c = _cfg()
    return all([c["base_url"], c["client_id"], c["client_secret"], c["tenant_id"], c["app_id"]])


async def _get_immybot_token() -> str:
    global _immy_token_value, _immy_token_expires

    if _immy_token_value and time.monotonic() < _immy_token_expires:
        return _immy_token_value

    c = _cfg()
    url = f"https://login.microsoftonline.com/{c['tenant_id']}/oauth2/v2.0/token"

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            url,
            data={
                "client_id": c["client_id"],
                "client_secret": c["client_secret"],
                "scope": f"{c['app_id']}/.default",
                "grant_type": "client_credentials",
            },
        )

    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Failed to acquire ImmyBot token: {r.text}")

    data = r.json()
    token = data.get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="ImmyBot token response missing access_token")

    _immy_token_value   = token
    _immy_token_expires = time.monotonic() + max(data.get("expires_in", 3600) - 60, 60)
    return _immy_token_value


def _collect_macs(c: dict) -> list[str]:
    """Collect all MAC addresses from an ImmyBot computer record."""
    macs: set[str] = set()
    for field in ("macAddress", "primaryMacAddress"):
        val = c.get(field, "")
        if val:
            macs.add(val)
    adapter = c.get("networkAdapter") or {}
    if adapter.get("macAddress"):
        macs.add(adapter["macAddress"])
    for adapter in c.get("networkAdapters") or []:
        if isinstance(adapter, dict) and adapter.get("macAddress"):
            macs.add(adapter["macAddress"])
    return [m for m in macs if m]


def _shape_computer(c: dict, base_url: str) -> dict:
    """
    Single canonical shape for an ImmyBot computer record.
    Used by both the device search/lookup path and the user-lookup path so both
    surfaces always show the same fields.
    """
    ip = (
        c.get("lastKnownIPAddress") or
        c.get("ipv4Address") or
        c.get("ipAddress") or
        c.get("lastIpAddress") or ""
    )
    macs = _collect_macs(c)
    return {
        "id":               c.get("id"),
        "name":             c.get("computerName") or "",
        "isOnline":         c.get("isOnline", False),
        "operatingSystem":  c.get("operatingSystem"),
        "manufacturer":     c.get("manufacturer"),
        "model":            c.get("model"),
        "serialNumber":     c.get("serialNumber"),
        "lastSeen":         c.get("lastOnline") or c.get("updatedDate"),
        "lastBootTime":     c.get("lastBootTimeUtc"),
        "primaryUserEmail": c.get("primaryUserEmail"),
        "primaryUserName":  f"{c.get('primaryUserFirstName', '')} {c.get('primaryUserLastName', '')}".strip(),
        "tenantName":       c.get("tenantName"),
        "ipAddress":        ip,
        "macAddress":       macs[0] if macs else "",
        "macAddresses":     macs,
        "immybotUrl":       f"{base_url}/computers/{c.get('id')}" if c.get("id") else None,
    }


async def _get_all_immybot_computers() -> list[dict]:
    """
    Paginate through all ImmyBot computers.  Results are cached for COMPUTERS_TTL
    seconds so concurrent callers (device search + user lookup) share one fetch.
    """
    global _computers_cache, _computers_expires

    if not is_immybot_configured():
        raise HTTPException(status_code=503, detail="ImmyBot credentials not configured.")

    # Fast path
    if _computers_cache is not None and time.monotonic() < _computers_expires:
        return _computers_cache

    # Slow path — only one concurrent fetch regardless of how many callers are waiting
    async with _get_computers_lock():
        if _computers_cache is not None and time.monotonic() < _computers_expires:
            return _computers_cache

        c = _cfg()
        base_url = c["base_url"]
        token = await _get_immybot_token()
        headers = {"Authorization": f"Bearer {token}"}

        # Sort by id ascending so skip-based pagination has a stable order.
        # Avoid sortDesc=true and nullable sort fields — ImmyBot drops records at
        # page boundaries when a sort field is null (e.g. onboardingStatus=2 devices
        # have null values for several fields).  id is never null, so this is safe.
        all_results: list[dict] = []
        take = 500
        skip = 0

        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                r = await client.get(
                    f"{base_url}/api/v1/computers/paged",
                    headers=headers,
                    params={"take": take, "skip": skip, "includeOffline": "true",
                            "sortField": "id", "sortDesc": "false"},
                )
                if r.status_code >= 400:
                    raise HTTPException(status_code=r.status_code, detail=r.text)
                data = r.json()
                batch = data.get("results", [])
                if not batch:
                    break
                all_results.extend(batch)
                if len(batch) < take:
                    break
                skip += take

        _computers_cache   = all_results
        _computers_expires = time.monotonic() + COMPUTERS_TTL
        return all_results


@router.get("/computers")
async def get_user_computers(email: str | None = Query(default=None)):
    c = _cfg()
    base_url = c["base_url"]

    results = await _get_all_immybot_computers()

    if email:
        email_lower = email.strip().lower()
        matched = [
            x for x in results
            if (x.get("primaryUserEmail") or "").strip().lower() == email_lower
        ]

        # Supplement: ImmyBot's unfiltered /paged endpoint silently excludes some
        # devices (e.g. onboardingStatus=2).  The filter param uses a different code
        # path that does return them.  Query by email so assigned devices always appear
        # even when pagination missed them.
        try:
            token = await _get_immybot_token()
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(
                    f"{base_url}/api/v1/computers/paged",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"filter": email, "take": 50, "includeOffline": "true"},
                )
                if r.status_code < 400:
                    existing_ids = {x.get("id") for x in matched}
                    for comp in r.json().get("results", []):
                        user_email = (comp.get("primaryUserEmail") or "").strip().lower()
                        if user_email == email_lower and comp.get("id") not in existing_ids:
                            matched.append(comp)
                            # Warm the shared filter cache and persist to DB so the
                            # next /search call shows in_immybot immediately and the
                            # device survives server restarts.
                            try:
                                from .devices import (
                                    _immybot_filter_cache, _normalize_name,
                                    _db_save_filter_device,
                                )
                                key = _normalize_name(comp.get("computerName", ""))
                                if key and key not in _immybot_filter_cache:
                                    shaped = _shape_computer(comp, base_url)
                                    _immybot_filter_cache[key] = shaped
                                    await _db_save_filter_device(
                                        key,
                                        comp.get("id"),
                                        shaped,
                                        comp.get("lastProviderAgentEventDateUtc"),
                                    )
                            except Exception:
                                pass
        except Exception:
            pass

        results = matched

    computers = [_shape_computer(x, base_url) for x in results]
    return {"count": len(computers), "computers": computers}


@router.get("/stats")
async def get_device_stats():
    results = await _get_all_immybot_computers()
    total = len(results)
    online = sum(1 for c in results if c.get("isOnline"))

    return {
        "total": total,
        "online": online,
        "offline": total - online,
    }
