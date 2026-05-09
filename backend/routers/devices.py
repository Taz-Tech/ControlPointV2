import os
import json
import time
import uuid
import asyncio
import httpx
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Query, HTTPException
from jose import jwt as jose_jwt
from sqlalchemy import select, delete

from .immybot import _get_immybot_token, _cfg as _immy_cfg, is_immybot_configured, _get_all_immybot_computers, _shape_computer, _collect_macs
from .intune import _get_intune_token, is_intune_configured, _shape_device as _shape_intune
from ..database import AsyncSessionLocal
from ..models import ImmybotDeviceCache, DeviceRecord

router = APIRouter(prefix="/api/devices", tags=["devices"])

# In-memory cache for devices found via ImmyBot server-side filter fallback.
# Populated by /lookup and proactively by /search when pagination misses a device.
# Pre-loaded from Supabase on startup so it survives server restarts.
_immybot_filter_cache: dict[str, dict] = {}  # normalized_name -> shaped device

# Tracks normalized names confirmed absent from ImmyBot via filter so we don't
# re-probe them on every /search call.  TTL-based so new enrollments are picked up.
_immy_filter_miss_cache: dict[str, float] = {}  # normalized_name -> expire_monotonic
_MISS_CACHE_TTL = 300  # seconds (5 minutes)


async def load_filter_cache_from_db() -> None:
    """
    Called once at startup.  Reads persisted ImmyBot filter-cache rows from Supabase
    and populates _immybot_filter_cache so invisible devices are available immediately
    without waiting for background probes to re-discover them.
    """
    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(select(ImmybotDeviceCache))).scalars().all()
        for row in rows:
            _immybot_filter_cache[row.normalized_name] = json.loads(row.shaped_json)
    except Exception:
        pass  # DB not ready yet or empty — in-memory cache starts empty, probes fill it


async def _db_save_filter_device(normalized_name: str, immybot_id: int | None,
                                  shaped: dict, last_event_at: str | None) -> None:
    """
    Upsert a single filter-found device into Supabase.  Skips the write if
    last_event_at hasn't changed (avoids thrashing on repeated lookups).
    """
    if not immybot_id:
        return
    try:
        async with AsyncSessionLocal() as session:
            existing = await session.get(ImmybotDeviceCache, immybot_id)
            if existing and existing.last_event_at == last_event_at:
                return  # nothing changed — skip the write
            now_iso = datetime.now(timezone.utc).isoformat()
            if existing:
                existing.normalized_name = normalized_name
                existing.shaped_json     = json.dumps(shaped)
                existing.last_event_at   = last_event_at
                existing.cached_at       = now_iso
            else:
                session.add(ImmybotDeviceCache(
                    immybot_id      = immybot_id,
                    normalized_name = normalized_name,
                    shaped_json     = json.dumps(shaped),
                    last_event_at   = last_event_at,
                    cached_at       = now_iso,
                ))
            await session.commit()
    except Exception:
        pass

CYLANCE_AUTH_URL = "https://protectapi.cylance.com/auth/v2/token"
CYLANCE_BASE_URL = "https://protectapi.cylance.com"


def _cylance_cfg():
    return {
        "tenant_id":  os.getenv("CYLANCE_TENANT_ID",  "").strip(),
        "app_id":     os.getenv("CYLANCE_APP_ID",     "").strip(),
        "app_secret": os.getenv("CYLANCE_APP_SECRET", "").strip(),
    }


def is_cylance_configured() -> bool:
    c = _cylance_cfg()
    return all([c["tenant_id"], c["app_id"], c["app_secret"]])


def _build_cylance_auth_token(tenant_id: str, app_id: str, app_secret: str) -> str:
    now = datetime.utcnow()
    timeout_dt = now + timedelta(seconds=1800)
    epoch_now = int((now - datetime(1970, 1, 1)).total_seconds())
    epoch_exp = int((timeout_dt - datetime(1970, 1, 1)).total_seconds())
    claims = {
        "exp": epoch_exp,
        "iat": epoch_now,
        "iss": "http://cylance.com",
        "sub": app_id,
        "tid": tenant_id,
        "jti": str(uuid.uuid4()),
    }
    return jose_jwt.encode(claims, app_secret, algorithm="HS256")


async def _get_cylance_token() -> str:
    c = _cylance_cfg()
    auth_token = _build_cylance_auth_token(c["tenant_id"], c["app_id"], c["app_secret"])
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            CYLANCE_AUTH_URL,
            headers={"Content-Type": "application/json; charset=utf-8"},
            json={"auth_token": auth_token},
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Failed to acquire Cylance token: {r.status_code}")
    return r.json().get("access_token", "")


def _normalize_name(name: str) -> str:
    """Lowercase and strip domain suffix so 'LAPTOP01.corp.com' matches 'laptop01'."""
    if not name:
        return ""
    return name.lower().split(".")[0].strip()


def _extract_addresses(raw) -> list[str]:
    """Handles both plain string lists and lists of address objects."""
    if not raw:
        return []
    result = []
    for item in raw:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            result.append(item.get("address") or item.get("ip") or item.get("mac") or str(item))
    return [r for r in result if r]


# _collect_immy_macs and _shape_immy have been consolidated into _collect_macs
# and _shape_computer in immybot.py — imported above.


def _shape_cylance(d: dict) -> dict:
    return {
        "id":             d.get("id", ""),
        "name":           d.get("name", ""),
        "state":          d.get("state"),
        "agentVersion":   d.get("agent_version"),
        "osVersion":      d.get("os_kernel_version"),
        "policy":         (d.get("policy") or {}).get("name"),
        "ipAddresses":    _extract_addresses(d.get("ip_addresses")),
        "macAddresses":   _extract_addresses(d.get("mac_addresses")),
        "dateRegistered": d.get("date_first_registered"),
        "dateOffline":    d.get("date_offline"),
        "dlcmStatus":     d.get("dlcm_status"),
    }


async def _immybot_filter_lookup(name: str, base_url: str, token: str) -> dict | None:
    """
    Query ImmyBot's server-side filter for a single device name.
    The /paged endpoint silently omits some devices (e.g. onboardingStatus=2);
    the filter param uses a different code path that does return them.
    Results are cached in _immybot_filter_cache so /search picks them up for free.
    """
    key = _normalize_name(name)
    if not key:
        return None
    if key in _immybot_filter_cache:
        return _immybot_filter_cache[key]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{base_url}/api/v1/computers/paged",
                headers={"Authorization": f"Bearer {token}"},
                params={"filter": name, "take": 5, "includeOffline": "true"},
            )
            if r.status_code < 400:
                for c in r.json().get("results", []):
                    if _normalize_name(c.get("computerName", "")) == key:
                        result = _shape_computer(c, base_url)
                        _immybot_filter_cache[key] = result
                        return result
    except Exception:
        pass
    return None


async def _fetch_immybot_devices() -> tuple[list[dict], str | None]:
    if not is_immybot_configured():
        return [], None
    try:
        base_url = _immy_cfg()["base_url"]
        all_results = await _get_all_immybot_computers()
        return [_shape_computer(c, base_url) for c in all_results], None
    except Exception as e:
        return [], f"ImmyBot: {str(e)}"


async def _fetch_cylance_devices() -> tuple[list[dict], str | None]:
    if not is_cylance_configured():
        return [], None
    try:
        token   = await _get_cylance_token()
        headers = {"Authorization": f"Bearer {token}"}
        # Pages are 1-indexed; max page_size is 10,000 per the API docs
        all_items: list[dict] = []
        page = 1

        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                r = await client.get(
                    f"{CYLANCE_BASE_URL}/devices/v2",
                    headers=headers,
                    params={"page": page, "page_size": 10000},
                )
                if r.status_code >= 400:
                    return [], f"Aurora API error {r.status_code}: {r.text[:200]}"
                data  = r.json()
                batch = data.get("page_items", [])
                all_items.extend(batch)
                total_pages = data.get("total_pages", 1)
                if page >= total_pages:
                    break
                page += 1

        return [_shape_cylance(d) for d in all_items], None
    except Exception as e:
        return [], f"Aurora: {str(e)}"


async def _fetch_intune_devices() -> tuple[list[dict], str | None]:
    if not is_intune_configured():
        return [], None
    try:
        token = await _get_intune_token()
        headers = {"Authorization": f"Bearer {token}"}
        all_devices: list[dict] = []
        url = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices"
        async with httpx.AsyncClient(timeout=60) as client:
            while url:
                r = await client.get(url, headers=headers, params={"$top": 999} if "?" not in url else {})
                if r.status_code >= 400:
                    return [], f"Intune API error {r.status_code}"
                data = r.json()
                all_devices.extend(data.get("value", []))
                url = data.get("@odata.nextLink")
        return [_shape_intune(d) for d in all_devices], None
    except Exception as e:
        return [], f"Intune: {str(e)}"


@router.get("/debug")
async def debug_device(q: str = Query(..., min_length=1)):
    """
    Paginates both APIs without any filter, matches device names containing
    the search term client-side, and returns raw + normalized names so you can
    see exactly why a device is or isn't being linked across systems.
    """
    q_lower = q.lower()
    out = {
        "query": q,
        "immybot": [],
        "aurora": [],
        "intune": [],
        "immybot_total": 0,
        "aurora_total": 0,
        "intune_total": 0,
        "immybot_sample": [],
        "immybot_filtered": [],
        "matched_keys": [],
        "immybot_only_keys": [],
        "aurora_only_keys": [],
    }

    # ── ImmyBot — use shared fetch (same params as /api/immybot/computers) ───────
    if is_immybot_configured():
        try:
            base_url = _immy_cfg()["base_url"]
            token    = await _get_immybot_token()
            all_computers = await _get_all_immybot_computers()
            out["immybot_total"] = len(all_computers)

            # Probe ImmyBot's own total so we can detect if pagination stopped short
            async with httpx.AsyncClient(timeout=15) as probe_client:
                rp = await probe_client.get(
                    f"{base_url}/api/v1/computers/paged",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"take": 1, "skip": 0, "includeOffline": "true"},
                )
                if rp.status_code < 400:
                    probe_data = rp.json()
                    out["immybot_response_keys"] = list(probe_data.keys())
                    for key in ("totalCount", "total", "count", "totalResults", "totalRecords"):
                        if key in probe_data:
                            out["immybot_api_total"] = probe_data[key]
                            break

            # Server-side filtered search to surface filtered results separately
            async with httpx.AsyncClient(timeout=30) as client:
                rf = await client.get(
                    f"{base_url}/api/v1/computers/paged",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"filter": q, "take": 50, "includeOffline": "true"},
                )
                if rf.status_code < 400:
                    for c in rf.json().get("results", []):
                        raw = c.get("computerName", "")
                        out["immybot_filtered"].append({
                            "raw_name":   raw,
                            "normalized": _normalize_name(raw),
                            "raw_record": c,
                        })

            # Check if server-side filtered devices appear in paginated results by ID
            paginated_by_id = {c.get("id"): c for c in all_computers if c.get("id") is not None}
            id_checks = []
            for entry in out["immybot_filtered"]:
                device_id = entry["raw_record"].get("id")
                if device_id is not None:
                    found = device_id in paginated_by_id
                    id_checks.append({
                        "id": device_id,
                        "in_paginated_results": found,
                        "paginated_computerName": paginated_by_id[device_id].get("computerName") if found else None,
                    })
            out["immybot_filtered_id_check"] = id_checks

            for c in all_computers:
                raw = c.get("computerName", "")
                if len(out["immybot_sample"]) < 5:
                    out["immybot_sample"].append(raw)
                all_str_values = " ".join(str(v) for v in c.values() if isinstance(v, str))
                if q_lower in raw.lower() or q_lower in all_str_values.lower():
                    out["immybot"].append({
                        "raw_name":   raw,
                        "normalized": _normalize_name(raw),
                        "raw_record": c,
                    })
        except Exception as e:
            out["immybot_error"] = str(e)

    # ── Cylance — paginate, no filter, match by name client-side ─────────────
    if is_cylance_configured():
        try:
            token = await _get_cylance_token()
            page  = 1
            async with httpx.AsyncClient(timeout=60) as client:
                while True:
                    r = await client.get(
                        f"{CYLANCE_BASE_URL}/devices/v2",
                        headers={"Authorization": f"Bearer {token}"},
                        params={"page": page, "page_size": 10000},
                    )
                    if r.status_code >= 400:
                        break
                    data  = r.json()
                    batch = data.get("page_items", [])
                    out["aurora_total"] += len(batch)
                    for d in batch:
                        raw = d.get("name", "")
                        if q_lower in raw.lower():
                            out["aurora"].append({
                                "raw_name":   raw,
                                "normalized": _normalize_name(raw),
                                "raw_record": d,   # full API response so we can see exact field names
                            })
                    total_pages = data.get("total_pages", 1)
                    if page >= total_pages:
                        break
                    page += 1
        except Exception as e:
            out["aurora_error"] = str(e)

    # ── Intune — paginate via Graph API, match by deviceName client-side ─────
    if is_intune_configured():
        try:
            token = await _get_intune_token()
            url   = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices"
            async with httpx.AsyncClient(timeout=60) as client:
                while url:
                    r = await client.get(
                        url,
                        headers={"Authorization": f"Bearer {token}"},
                        params={"$top": 999} if "?" not in url else {},
                    )
                    if r.status_code >= 400:
                        break
                    data  = r.json()
                    batch = data.get("value", [])
                    out["intune_total"] += len(batch)
                    for d in batch:
                        raw = d.get("deviceName", "")
                        if q_lower in raw.lower():
                            out["intune"].append({
                                "raw_name":   raw,
                                "normalized": _normalize_name(raw),
                                "raw_record": d,
                            })
                    url = data.get("@odata.nextLink")
        except Exception as e:
            out["intune_error"] = str(e)

    immy_keys   = {e["normalized"] for e in out["immybot"]}
    cyl_keys    = {e["normalized"] for e in out["aurora"]}
    intune_keys = {e["normalized"] for e in out["intune"]}
    all_debug_keys = immy_keys | cyl_keys | intune_keys
    out["matched_keys"]       = sorted(immy_keys & cyl_keys & intune_keys if intune_keys else immy_keys & cyl_keys)
    out["immybot_only_keys"]  = sorted(immy_keys  - cyl_keys - intune_keys)
    out["aurora_only_keys"]   = sorted(cyl_keys   - immy_keys - intune_keys)
    out["intune_only_keys"]   = sorted(intune_keys - immy_keys - cyl_keys)
    return out


@router.get("/lookup")
async def lookup_device(name: str = Query(..., min_length=1)):
    """Look up a single device by name across ImmyBot, Aurora, and Intune."""
    key = _normalize_name(name)
    (immy_devices, _), (cylance_devices, _), (intune_devices, _) = await asyncio.gather(
        _fetch_immybot_devices(),
        _fetch_cylance_devices(),
        _fetch_intune_devices(),
    )

    immy    = next((d for d in immy_devices    if _normalize_name(d["name"]) == key), None)
    cylance = next((d for d in cylance_devices if _normalize_name(d["name"]) == key), None)
    intune  = next((d for d in intune_devices  if _normalize_name(d["name"]) == key), None)

    # ImmyBot's /paged endpoint silently omits some devices; fall back to filter lookup.
    if immy is None and is_immybot_configured():
        try:
            base_url   = _immy_cfg()["base_url"]
            immy_token = await _get_immybot_token()
            immy = await _immybot_filter_lookup(name, base_url, immy_token)
            # Persist to DB so this device survives restarts (single await, no pool pressure)
            if immy:
                await _db_save_filter_device(
                    _normalize_name(name), immy.get("id"), immy, immy.get("lastSeen")
                )
        except Exception:
            pass

    if not immy and not cylance and not intune:
        raise HTTPException(status_code=404, detail=f"Device '{name}' not found in any system.")

    return {
        "name":       (immy or cylance or intune).get("name", name),
        "in_immybot": immy is not None,
        "in_aurora":  cylance is not None,
        "in_intune":  intune is not None,
        "immybot":    immy,
        "aurora":     cylance,
        "intune":     intune,
    }


@router.get("/search")
async def search_devices():
    (immy_devices, immy_err), (cylance_devices, cyl_err), (intune_devices, intune_err) = await asyncio.gather(
        _fetch_immybot_devices(),
        _fetch_cylance_devices(),
        _fetch_intune_devices(),
    )

    errors = [e for e in [immy_err, cyl_err, intune_err] if e]

    # ── Index each source by normalized hostname ──────────────────────────────
    cylance_map: dict[str, dict] = {}
    for d in cylance_devices:
        key = _normalize_name(d["name"])
        if key:
            cylance_map[key] = d

    immy_map: dict[str, dict] = {}
    for d in immy_devices:
        key = _normalize_name(d["name"])
        if not key:
            # Device has no computerName — use serial or internal id so it still
            # appears rather than being silently dropped.
            sn = (d.get("serialNumber") or "").strip().lower()
            key = f"immy-sn-{sn}" if sn else f"immy-id-{d.get('id', id(d))}"
        immy_map[key] = d

    intune_map: dict[str, dict] = {}
    for d in intune_devices:
        key = _normalize_name(d["name"])
        if key:
            intune_map[key] = d

    # Supplement with devices found via filter fallback during /lookup calls.
    for k, d in _immybot_filter_cache.items():
        if k not in immy_map:
            immy_map[k] = d

    # ── Secondary pass: match unjoined ImmyBot devices by serial number ───────
    # Catches the common case where a device has a different hostname in ImmyBot
    # vs Aurora/Intune (e.g. "DESKTOP-ABC123" in ImmyBot, "CORP-LAPTOP-07" in Aurora).
    # Serial number is a hardware-level ID that doesn't vary across management tools.
    aurora_serial_idx = {
        (d.get("serialNumber") or "").strip().lower(): k
        for k, d in cylance_map.items()
        if (d.get("serialNumber") or "").strip()
    }
    intune_serial_idx = {
        (d.get("serialNumber") or "").strip().lower(): k
        for k, d in intune_map.items()
        if (d.get("serialNumber") or "").strip()
    }

    # Only consider ImmyBot keys that have no match in Aurora or Intune yet
    unmatched_immy = {k for k in immy_map if k not in cylance_map and k not in intune_map}

    for immy_key in list(unmatched_immy):
        immy_d = immy_map[immy_key]
        sn = (immy_d.get("serialNumber") or "").strip().lower()
        if not sn:
            continue
        canonical_key = aurora_serial_idx.get(sn) or intune_serial_idx.get(sn)
        if canonical_key and canonical_key != immy_key:
            # Re-register the ImmyBot device under the Aurora/Intune name key so
            # the three systems collapse into one merged row instead of two.
            immy_map[canonical_key] = immy_d
            del immy_map[immy_key]

    # ── Background filter probes for ImmyBot-invisible devices ─────────────────
    # ImmyBot's unfiltered /paged endpoint silently excludes some devices
    # (e.g. onboardingStatus=2).  The filter param uses a different server code
    # path that does return them.  Fire off probes for ALL unmatched Aurora/Intune
    # devices as a background asyncio task so the response is not delayed.  Hits
    # land in _immybot_filter_cache and are merged into the NEXT search call.
    # Misses are cached for _MISS_CACHE_TTL seconds to avoid redundant probes.
    if is_immybot_configured():
        _now = time.monotonic()
        _need_probe = [
            k for k in (set(cylance_map) | set(intune_map))
            if k not in immy_map
            and k not in _immybot_filter_cache
            and _immy_filter_miss_cache.get(k, 0) < _now
        ]
        if _need_probe:
            try:
                _immy_base = _immy_cfg()["base_url"]
                _immy_tok  = await _get_immybot_token()

                async def _bg_probes():
                    sem = asyncio.Semaphore(8)   # limit concurrent ImmyBot filter calls
                    hits: list[tuple] = []        # (key, raw_record) collected for batch DB write

                    async def _probe(key: str):
                        async with sem:
                            dev = cylance_map.get(key) or intune_map.get(key)
                            if not dev:
                                return
                            name = dev.get("name", "")
                            if not name:
                                return
                            result = await _immybot_filter_lookup(name, _immy_base, _immy_tok)
                            if result:
                                hits.append((key, result))
                            else:
                                _immy_filter_miss_cache[key] = _now + _MISS_CACHE_TTL

                    await asyncio.gather(*(_probe(k) for k in _need_probe))

                    # One DB session for all hits — avoids opening N concurrent connections
                    if hits:
                        now_iso = datetime.now(timezone.utc).isoformat()
                        try:
                            async with AsyncSessionLocal() as session:
                                for key, shaped in hits:
                                    immy_id = shaped.get("id")
                                    if not immy_id:
                                        continue
                                    existing = await session.get(ImmybotDeviceCache, immy_id)
                                    last_evt  = shaped.get("lastSeen")  # closest field in shaped dict
                                    if existing:
                                        existing.shaped_json   = json.dumps(shaped)
                                        existing.last_event_at = last_evt
                                        existing.cached_at     = now_iso
                                    else:
                                        session.add(ImmybotDeviceCache(
                                            immybot_id      = immy_id,
                                            normalized_name = key,
                                            shaped_json     = json.dumps(shaped),
                                            last_event_at   = last_evt,
                                            cached_at       = now_iso,
                                        ))
                                await session.commit()
                        except Exception:
                            pass

                asyncio.create_task(_bg_probes())
            except Exception:
                pass

    # ── Merge ─────────────────────────────────────────────────────────────────
    all_keys = set(cylance_map) | set(immy_map) | set(intune_map)
    merged = []

    for key in all_keys:
        immy    = immy_map.get(key)
        cylance = cylance_map.get(key)
        intune  = intune_map.get(key)
        display_name = (immy or cylance or intune).get("name", key)
        merged.append({
            "name":       display_name,
            "in_immybot": immy is not None,
            "in_aurora":  cylance is not None,
            "in_intune":  intune is not None,
            "immybot":    immy,
            "aurora":     cylance,
            "intune":     intune,
        })

    merged.sort(key=lambda d: (0 if (d["in_immybot"] and d["in_aurora"] and d["in_intune"]) else 1, d["name"].lower()))

    return {
        "devices":            merged,
        "total":              len(merged),
        "immybot_configured": is_immybot_configured(),
        "aurora_configured":  is_cylance_configured(),
        "intune_configured":  is_intune_configured(),
        "errors":             errors,
    }


def _shape_threat(item: dict) -> dict:
    return {
        "name":            item.get("name", ""),
        "filePath":        item.get("file_path", ""),
        "status":          item.get("file_status"),
        "classification":  item.get("classification"),
        "subClassification": item.get("sub_classification"),
        "score":           item.get("cylance_score"),
        "dateFound":       item.get("date_found"),
        "sha256":          item.get("sha256", ""),
        "md5":             item.get("md5", ""),
    }


@router.get("/exploits")
async def get_device_exploits(name: str = Query(..., min_length=1)):
    """Fetch Aurora threats for a specific device using the device-specific threats endpoint."""
    if not is_cylance_configured():
        raise HTTPException(status_code=503, detail="Aurora (Cylance) is not configured.")

    token   = await _get_cylance_token()
    headers = {"Authorization": f"Bearer {token}"}
    target  = _normalize_name(name)

    # Step 1: Resolve the Aurora device ID by name
    device_id = None
    async with httpx.AsyncClient(timeout=60) as client:
        page = 1
        while True:
            r = await client.get(
                f"{CYLANCE_BASE_URL}/devices/v2",
                headers=headers,
                params={"page": page, "page_size": 10000},
            )
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Aurora API error {r.status_code}: {r.text[:200]}")
            data = r.json()
            for d in data.get("page_items", []):
                if _normalize_name(d.get("name", "")) == target:
                    device_id = d.get("id")
                    break
            if device_id or page >= data.get("total_pages", 1):
                break
            page += 1

    if not device_id:
        return {"device": name, "device_id": None, "exploits": [], "total": 0}

    # Step 2: Fetch threats for this device via the device-specific endpoint
    results: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while True:
            try:
                r = await client.get(
                    f"{CYLANCE_BASE_URL}/devices/v2/{device_id}/threats",
                    headers=headers,
                    params={"page": page, "page_size": 200},
                )
            except Exception:
                break

            if r.status_code == 404:
                break
            if r.status_code == 204 or not r.content:
                break
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Aurora API error {r.status_code}: {r.text[:200]}")

            try:
                data = r.json()
            except Exception:
                break

            for item in data.get("page_items", []):
                results.append(_shape_threat(item))

            if page >= data.get("total_pages", 1):
                break
            page += 1

    results.sort(key=lambda x: x.get("dateFound") or "", reverse=True)
    return {"device": name, "device_id": device_id, "exploits": results, "total": len(results)}


# ── Unified device inventory ───────────────────────────────────────────────────

def _record_to_dict(r: DeviceRecord) -> dict:
    return {
        "id":               r.id,
        "normalized_name":  r.normalized_name,
        "name":             r.name,
        "serial_number":    r.serial_number,
        "manufacturer":     r.manufacturer,
        "model":            r.model,
        "operating_system": r.operating_system,
        "primary_user_email": r.primary_user_email,
        "primary_user_name":  r.primary_user_name,
        "last_updated":     r.last_updated,
        "immy": {
            "id":        r.immy_id,
            "is_online": r.immy_is_online,
            "last_seen": r.immy_last_seen,
            "last_boot": r.immy_last_boot,
            "tenant":    r.immy_tenant,
            "url":       r.immy_url,
            "ip":        r.immy_ip,
            "mac":       r.immy_mac,
            "synced_at": r.immy_synced_at,
        } if r.immy_id else None,
        "intune": {
            "id":          r.intune_id,
            "upn":         r.intune_upn,
            "os_version":  r.intune_os_version,
            "compliance":  r.intune_compliance,
            "mgmt_state":  r.intune_mgmt_state,
            "enrolled_at": r.intune_enrolled_at,
            "last_sync":   r.intune_last_sync,
            "encrypted":   r.intune_encrypted,
            "owner_type":  r.intune_owner_type,
            "synced_at":   r.intune_synced_at,
        } if r.intune_id else None,
        "aurora": {
            "id":          r.aurora_id,
            "state":       r.aurora_state,
            "agent_ver":   r.aurora_agent_ver,
            "policy":      r.aurora_policy,
            "ips":         json.loads(r.aurora_ips)  if r.aurora_ips  else [],
            "macs":        json.loads(r.aurora_macs) if r.aurora_macs else [],
            "registered":  r.aurora_registered,
            "offline":     r.aurora_offline,
            "dlcm":        r.aurora_dlcm,
            "synced_at":   r.aurora_synced_at,
        } if r.aurora_id else None,
    }


@router.post("/sync-all")
async def sync_all_devices():
    """Pull all devices from ImmyBot, Intune, and Aurora and upsert into device_records."""
    now = datetime.now(timezone.utc).isoformat()

    immy_devices,   immy_err   = await _fetch_immybot_devices()
    intune_devices, intune_err = await _fetch_intune_devices()
    aurora_devices, aurora_err = await _fetch_cylance_devices()

    # Index each source by normalized name
    immy_map:   dict[str, dict] = {}
    intune_map: dict[str, dict] = {}
    aurora_map: dict[str, dict] = {}

    for d in immy_devices:
        k = _normalize_name(d.get("name") or "")
        if k:
            immy_map[k] = d

    for d in intune_devices:
        k = _normalize_name(d.get("name") or "")
        if k:
            intune_map[k] = d

    for d in aurora_devices:
        k = _normalize_name(d.get("name") or "")
        if k:
            aurora_map[k] = d

    all_keys = set(immy_map) | set(intune_map) | set(aurora_map)

    async with AsyncSessionLocal() as session:
        for key in all_keys:
            immy   = immy_map.get(key)
            intune = intune_map.get(key)
            aurora = aurora_map.get(key)

            # Resolve best-available common fields: ImmyBot > Intune > Aurora
            name   = (immy or intune or aurora or {}).get("name") or key
            serial = (
                (immy   and immy.get("serialNumber"))   or
                (intune and intune.get("serialNumber")) or
                None
            )
            manufacturer = (
                (immy   and immy.get("manufacturer"))   or
                (intune and intune.get("manufacturer")) or
                None
            )
            model = (
                (immy   and immy.get("model"))   or
                (intune and intune.get("model")) or
                None
            )
            os_ = (
                (immy   and immy.get("operatingSystem"))   or
                (intune and intune.get("operatingSystem")) or
                None
            )
            user_email = (
                (immy   and immy.get("primaryUserEmail"))       or
                (intune and intune.get("userPrincipalName"))    or
                None
            )
            user_name = (
                (immy   and immy.get("primaryUserName"))    or
                (intune and intune.get("userDisplayName"))  or
                None
            )

            existing = (await session.execute(
                select(DeviceRecord).where(DeviceRecord.normalized_name == key)
            )).scalar_one_or_none()

            if not existing:
                existing = DeviceRecord(normalized_name=key)
                session.add(existing)

            existing.name             = name
            existing.serial_number    = serial
            existing.manufacturer     = manufacturer
            existing.model            = model
            existing.operating_system = os_
            existing.primary_user_email = user_email
            existing.primary_user_name  = user_name
            existing.last_updated     = now

            if immy:
                existing.immy_id        = immy.get("id")
                existing.immy_is_online = immy.get("isOnline")
                existing.immy_last_seen = immy.get("lastSeen")
                existing.immy_last_boot = immy.get("lastBootTime")
                existing.immy_tenant    = immy.get("tenantName")
                existing.immy_url       = immy.get("immybotUrl")
                existing.immy_ip        = immy.get("ipAddress")
                existing.immy_mac       = immy.get("macAddress")
                existing.immy_synced_at = now

            if intune:
                existing.intune_id          = intune.get("id")
                existing.intune_upn         = intune.get("userPrincipalName")
                existing.intune_os_version  = intune.get("osVersion")
                existing.intune_compliance  = intune.get("complianceState")
                existing.intune_mgmt_state  = intune.get("managementState")
                existing.intune_enrolled_at = intune.get("enrolledDateTime")
                existing.intune_last_sync   = intune.get("lastSyncDateTime")
                existing.intune_encrypted   = intune.get("isEncrypted")
                existing.intune_owner_type  = intune.get("managedDeviceOwnerType")
                existing.intune_synced_at   = now

            if aurora:
                existing.aurora_id         = aurora.get("id")
                existing.aurora_state      = aurora.get("state")
                existing.aurora_agent_ver  = aurora.get("agentVersion")
                existing.aurora_policy     = aurora.get("policy")
                existing.aurora_ips        = json.dumps(aurora.get("ipAddresses") or [])
                existing.aurora_macs       = json.dumps(aurora.get("macAddresses") or [])
                existing.aurora_registered = aurora.get("dateRegistered")
                existing.aurora_offline    = aurora.get("dateOffline")
                existing.aurora_dlcm       = aurora.get("dlcmStatus")
                existing.aurora_synced_at  = now

        await session.commit()

    return {
        "synced":     len(all_keys),
        "immy_count":   len(immy_map),
        "intune_count": len(intune_map),
        "aurora_count": len(aurora_map),
        "errors":     [e for e in [immy_err, intune_err, aurora_err] if e],
    }


@router.get("/inventory")
async def get_device_inventory(
    q:      str | None = Query(default=None),
    source: str | None = Query(default=None),  # "immy" | "intune" | "aurora"
    limit:  int        = Query(default=500, le=2000),
    offset: int        = Query(default=0),
):
    """List device records from the unified inventory DB."""
    async with AsyncSessionLocal() as session:
        stmt = select(DeviceRecord)
        if q:
            q_lower = f"%{q.lower()}%"
            from sqlalchemy import or_, func
            stmt = stmt.where(or_(
                func.lower(DeviceRecord.name).like(q_lower),
                func.lower(DeviceRecord.normalized_name).like(q_lower),
                func.lower(DeviceRecord.serial_number).like(q_lower),
                func.lower(DeviceRecord.primary_user_email).like(q_lower),
                func.lower(DeviceRecord.primary_user_name).like(q_lower),
            ))
        if source == "immy":
            stmt = stmt.where(DeviceRecord.immy_id.isnot(None))
        elif source == "intune":
            stmt = stmt.where(DeviceRecord.intune_id.isnot(None))
        elif source == "aurora":
            stmt = stmt.where(DeviceRecord.aurora_id.isnot(None))

        total_stmt = stmt
        from sqlalchemy import func as sqlfunc
        count_result = await session.execute(
            select(sqlfunc.count()).select_from(total_stmt.subquery())
        )
        total = count_result.scalar() or 0

        stmt = stmt.order_by(DeviceRecord.name).offset(offset).limit(limit)
        rows = (await session.execute(stmt)).scalars().all()

    return {"total": total, "devices": [_record_to_dict(r) for r in rows]}


@router.get("/inventory/{normalized_name}")
async def get_device_record(normalized_name: str):
    async with AsyncSessionLocal() as session:
        row = (await session.execute(
            select(DeviceRecord).where(DeviceRecord.normalized_name == normalized_name)
        )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")
    return _record_to_dict(row)
