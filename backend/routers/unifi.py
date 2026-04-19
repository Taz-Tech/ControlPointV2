import os
import re
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from ..database import get_db
from ..models import Site, Switch, UnifiDevice, UnifiHostConfig, SeatMapping, UserRecord
from .settings import require_admin

router = APIRouter(prefix="/api/unifi", tags=["unifi"])

UNIFI_API_BASE       = "https://api.ui.com/v1"
UNIFI_EA_BASE        = "https://api.ui.com/ea"
UNIFI_CONNECTOR_BASE = "https://api.ui.com/v1/connector/consoles"


def _api_key() -> str | None:
    return os.environ.get("UNIFI_API_KEY", "").strip() or None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_name(d: dict) -> str:
    state = d.get("reportedState") or {}
    return (
        d.get("name") or d.get("hostName") or d.get("hostname")
        or state.get("hostname") or state.get("name")
        or d.get("id", "Unknown")
    )


def _classify_type(raw_type: str, model: str, name: str = "") -> str:
    t = raw_type.lower()
    m = model.lower()
    n = name.lower()
    # Gateways first — UDM/UXG match "udm"/"uxg" before the "u" AP prefix checks
    if any(k in t or k in m for k in ("ugw", "gateway", "udm", "uxg", "usg")):
        return "gateway"
    # Firewall devices by name convention (FRWL / FWRL) when model is missing
    if any(k in n for k in ("frwl", "fwrl", "firewall")):
        return "gateway"
    if any(k in t or k in m for k in ("usw", "switch")):
        return "switch"
    # APs: U6/U7 series use spaces ("U7 Pro", "U6 Enterprise") or hyphens ("U6-Lite")
    if any(k in t or k in m for k in ("uap", "u6", "u7", "u-nand", "access_point", "wifi", "ap-")):
        return "ap"
    # Catch remaining "access*" type strings (ACCESS_POINT, access_point_mesh, etc.)
    if "access" in t:
        return "ap"
    return raw_type or "unknown"


def _normalize_state(d: dict) -> str:
    s = d.get("state") or d.get("status") or ""
    if isinstance(s, str):
        return s.lower()
    return "online" if s == 1 else "offline"


class HostConfigBody(BaseModel):
    host_name:          str        = ""
    controller_url:     str | None = None
    controller_api_key: str | None = None
    unifi_site_name:    str | None = None


def _host_config_out(cfg: UnifiHostConfig) -> dict:
    return {
        "host_id":              cfg.host_id,
        "host_name":            cfg.host_name,
        "controller_url":       cfg.controller_url,
        "controller_configured": bool(cfg.controller_url and cfg.controller_api_key),
        "unifi_site_name":      cfg.unifi_site_name,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/hosts")
async def list_hosts():
    key = _api_key()
    if not key:
        raise HTTPException(status_code=503, detail="UniFi integration not configured.")

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                f"{UNIFI_API_BASE}/hosts",
                headers={"X-API-KEY": key, "Accept": "application/json"},
            )
        if r.status_code == 401:
            raise HTTPException(status_code=502, detail="UniFi API key is invalid.")
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="UniFi rate limit exceeded — try again shortly.")
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"UniFi API error {r.status_code}")
        hosts = r.json().get("data", [])
        for h in hosts:
            h["name"] = _extract_name(h)
        return hosts
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach UniFi API: {e}")


async def _connector_list_sites(host_id: str, api_key: str) -> list[dict]:
    """List UniFi sites for a console via the cloud connector proxy."""
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                f"{UNIFI_CONNECTOR_BASE}/{host_id}/proxy/network/integration/v1/sites",
                headers={"X-API-KEY": api_key, "Accept": "application/json"},
            )
        if r.status_code == 200:
            return r.json().get("data", [])
    except Exception:
        pass
    return []


async def _connector_list_devices(host_id: str, site_id: str, api_key: str) -> list[dict]:
    """Paginate all devices for a UniFi site via the cloud connector proxy."""
    devices: list[dict] = []
    offset, limit = 0, 200
    try:
        async with httpx.AsyncClient(timeout=25) as c:
            while True:
                r = await c.get(
                    f"{UNIFI_CONNECTOR_BASE}/{host_id}/proxy/network/integration/v1/sites/{site_id}/devices",
                    params={"limit": limit, "offset": offset},
                    headers={"X-API-KEY": api_key, "Accept": "application/json"},
                )
                if r.status_code != 200:
                    break
                page = r.json().get("data", [])
                devices.extend(page)
                if len(page) < limit:
                    break
                offset += limit
    except Exception:
        pass
    return devices


@router.get("/hosts/{host_id}/devices")
async def list_host_devices(host_id: str):
    key = _api_key()
    if not key:
        raise HTTPException(status_code=503, detail="UniFi integration not configured.")

    try:
        sites = await _connector_list_sites(host_id, key)
        if not sites:
            raise HTTPException(status_code=404, detail="No sites found for this host — verify the API key has access.")

        all_devices: list[dict] = []
        for s in sites:
            devs = await _connector_list_devices(host_id, s["id"], key)
            all_devices.extend(devs)

        for d in all_devices:
            d["name"] = _extract_name(d)
        return all_devices
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach UniFi API: {e}")


@router.get("/host-configs")
async def list_host_configs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UnifiHostConfig))
    return [_host_config_out(c) for c in result.scalars().all()]


@router.put("/host-configs/{host_id}")
async def upsert_host_config(
    host_id: str,
    body: HostConfigBody,
    _: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UnifiHostConfig).where(UnifiHostConfig.host_id == host_id))
    cfg = result.scalar_one_or_none()
    if cfg:
        if body.host_name:                    cfg.host_name          = body.host_name
        if body.controller_url  is not None:  cfg.controller_url     = body.controller_url  or None
        if body.controller_api_key:           cfg.controller_api_key = body.controller_api_key
        if body.unifi_site_name is not None:  cfg.unifi_site_name    = body.unifi_site_name or None
    else:
        cfg = UnifiHostConfig(
            host_id=host_id,
            host_name=body.host_name,
            controller_url=body.controller_url     or None,
            controller_api_key=body.controller_api_key or None,
            unifi_site_name=body.unifi_site_name   or None,
        )
        db.add(cfg)
    await db.commit()
    return _host_config_out(cfg)


@router.get("/host-configs/{host_id}/controller-sites")
async def get_host_controller_sites(host_id: str, db: AsyncSession = Depends(get_db)):
    """List UniFi sites for a host. Uses cloud connector (no local URL needed); falls back to local controller if configured."""
    key = _api_key()

    # Primary: cloud connector proxy — works without local network access
    if key:
        sites = await _connector_list_sites(host_id, key)
        if sites:
            return [{"name": s["id"], "desc": s.get("name") or s["id"]} for s in sites]

    # Fallback: local controller (if configured)
    result = await db.execute(select(UnifiHostConfig).where(UnifiHostConfig.host_id == host_id))
    cfg = result.scalar_one_or_none()
    if cfg and cfg.controller_url and cfg.controller_api_key:
        base = cfg.controller_url.rstrip("/")
        headers = {"X-API-KEY": cfg.controller_api_key, "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=15) as c:
                r = await c.get(f"{base}/proxy/network/integration/v1/sites", headers=headers)
            if r.status_code == 200:
                sites = r.json().get("data", [])
                return [{"name": s["id"], "desc": s.get("name") or s["id"]} for s in sites]
        except Exception:
            pass

    raise HTTPException(
        status_code=400,
        detail="Could not fetch sites. Ensure the UniFi API key is configured in Integrations.",
    )


@router.post("/sites/{site_id}/sync")
async def sync_devices(
    site_id: int,
    _: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    site_result = await db.execute(
        select(Site).where(Site.id == site_id).options(selectinload(Site.switches))
    )
    site = site_result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not site.unifi_host_id:
        raise HTTPException(status_code=400, detail="No UniFi host linked to this site — link one in Settings first.")

    key = _api_key()
    if not key:
        raise HTTPException(status_code=503, detail="UniFi integration not configured.")

    # Resolve which UniFi site(s) to pull from
    hc_result = await db.execute(
        select(UnifiHostConfig).where(UnifiHostConfig.host_id == site.unifi_host_id)
    )
    host_cfg = hc_result.scalar_one_or_none()
    unifi_site_name = site.unifi_site_name or (host_cfg.unifi_site_name if host_cfg else None)

    if unifi_site_name:
        # Specific site configured — fetch only that site's devices
        devices = await _connector_list_devices(site.unifi_host_id, unifi_site_name, key)
        if not devices and host_cfg and host_cfg.controller_url and host_cfg.controller_api_key:
            # Local controller fallback
            try:
                base = host_cfg.controller_url.rstrip("/")
                headers = {"X-API-KEY": host_cfg.controller_api_key, "Accept": "application/json"}
                async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=20) as c:
                    r = await c.get(
                        f"{base}/proxy/network/integration/v1/sites/{unifi_site_name}/devices",
                        headers=headers,
                    )
                if r.status_code == 200:
                    devices = r.json().get("data", [])
            except Exception:
                pass
    else:
        # No site pinned — enumerate all sites via cloud connector and sync everything
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                _sr = await c.get(
                    f"{UNIFI_CONNECTOR_BASE}/{site.unifi_host_id}/proxy/network/integration/v1/sites",
                    headers={"X-API-KEY": key, "Accept": "application/json"},
                )
            if _sr.status_code != 200:
                try:
                    _err = _sr.json().get("message") or _sr.text[:300]
                except Exception:
                    _err = _sr.text[:300]
                raise HTTPException(status_code=502, detail=f"UniFi connector error ({_sr.status_code}): {_err}")
            unifi_sites = _sr.json().get("data", [])
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Could not reach UniFi API: {e}")

        if not unifi_sites:
            raise HTTPException(status_code=502, detail="No UniFi sites returned for this console.")
        devices = []
        for us in unifi_sites:
            page = await _connector_list_devices(site.unifi_host_id, us["id"], key)
            devices.extend(page)
    now = datetime.now(timezone.utc).isoformat()
    site_switch_ids = {sw.id for sw in site.switches}

    counts = {"switches": 0, "access_points": 0, "other": 0}

    for d in devices:
        device_id   = d.get("id", "")
        name        = _extract_name(d)
        raw_type    = (d.get("type") or "").lower()
        mac         = d.get("mac") or d.get("macAddress") or ""
        ip          = d.get("ip") or d.get("ipAddress") or ""
        model       = d.get("model") or d.get("modelName") or ""
        state       = _normalize_state(d)
        device_type = _classify_type(raw_type, model, name)

        # Upsert UnifiDevice (full inventory for all types)
        ud_result = await db.execute(
            select(UnifiDevice).where(
                UnifiDevice.unifi_id == device_id,
                UnifiDevice.site_id  == site_id,
            )
        )
        ud = ud_result.scalar_one_or_none()
        if ud:
            ud.name = name; ud.device_type = device_type; ud.model = model
            ud.mac  = mac;  ud.ip = ip;  ud.state = state; ud.last_synced = now
        else:
            ud = UnifiDevice(
                unifi_id=device_id, site_id=site_id, name=name,
                device_type=device_type, model=model,
                mac=mac, ip=ip, state=state, last_synced=now,
            )
            db.add(ud)

        # For switches: also upsert into Switch table and associate with site
        if device_type == "switch":
            sw_result = await db.execute(
                select(Switch).where(Switch.unifi_device_id == device_id)
            )
            sw = sw_result.scalar_one_or_none()
            if sw:
                sw.name = name
                if ip: sw.ip_address = ip
                sw.mac_address = mac
                sw.model = model
            else:
                sw = Switch(
                    name=name, ip_address=ip or "0.0.0.0",
                    unifi_device_id=device_id, mac_address=mac, model=model,
                )
                db.add(sw)
                await db.flush()

            if sw.id not in site_switch_ids:
                site.switches.append(sw)
                site_switch_ids.add(sw.id)

            counts["switches"] += 1
        elif device_type == "ap":
            counts["access_points"] += 1
        else:
            counts["other"] += 1

    await db.commit()
    return {
        "synced": counts,
        "total": len(devices),
        "message": f"Synced {counts['switches']} switch(es) and {counts['access_points']} AP(s).",
    }


@router.get("/sites/{site_id}/controller-sites")
async def get_controller_sites(site_id: int, db: AsyncSession = Depends(get_db)):
    """Log into a site's local UniFi controller and return its list of network sites."""
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site = site_result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not (site.controller_url and site.controller_user and site.controller_pass):
        raise HTTPException(status_code=400, detail="Local controller credentials not configured for this site.")

    base = site.controller_url.rstrip("/")
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=15) as c:
            login = await c.post(
                f"{base}/api/login",
                json={"username": site.controller_user, "password": site.controller_pass},
            )
            if login.status_code == 400:
                raise HTTPException(status_code=502, detail="Invalid controller username or password.")
            if login.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Controller login failed ({login.status_code}).")

            r = await c.get(f"{base}/api/self/sites")
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Failed to fetch sites ({r.status_code}).")

        return [
            {"name": s["name"], "desc": s.get("desc") or s["name"]}
            for s in r.json().get("data", [])
        ]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not connect to controller: {e}")


@router.get("/sites/{site_id}/port-statuses")
async def get_port_statuses(site_id: int, map_id: int, db: AsyncSession = Depends(get_db)):
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site = site_result.scalar_one_or_none()
    if not site:
        return {}

    seats_result = await db.execute(
        select(SeatMapping)
        .where(SeatMapping.floor_map_id == map_id)
        .options(selectinload(SeatMapping.switch))
    )
    seats = seats_result.scalars().all()

    device_ids = {s.switch.unifi_device_id for s in seats if s.switch and s.switch.unifi_device_id}
    if not device_ids:
        return {}

    # ── Look up per-host local controller config ──────────────────────────────
    host_cfg = None
    if site.unifi_host_id:
        hc_result = await db.execute(
            select(UnifiHostConfig).where(UnifiHostConfig.host_id == site.unifi_host_id)
        )
        host_cfg = hc_result.scalar_one_or_none()

    # ── Local controller path (preferred — much richer data) ─────────────────
    if host_cfg and host_cfg.controller_url and host_cfg.controller_api_key and host_cfg.unifi_site_name:
        port_maps = await _port_maps_from_controller(
            host_cfg.controller_url, host_cfg.controller_api_key,
            host_cfg.unifi_site_name, device_ids,
        )
    # ── Cloud EA API fallback ─────────────────────────────────────────────────
    elif site.unifi_host_id:
        port_maps = await _port_maps_from_cloud(site.unifi_host_id, device_ids)
    else:
        return {}

    statuses: dict[str, str] = {}
    for seat in seats:
        if not (seat.switch and seat.switch.unifi_device_id and seat.port):
            continue
        ports = port_maps.get(seat.switch.unifi_device_id)
        if ports is None:
            continue
        key_raw = seat.port.strip()
        up = ports.get(key_raw) if key_raw in ports else ports.get(key_raw.lower())
        statuses[str(seat.id)] = "unknown" if up is None else ("up" if up else "down")

    return statuses


def _shape_ports(device: dict) -> list[dict]:
    """Extract a rich port list from a UniFi device detail dict.

    Handles two response schemas:
    - Legacy Network API:  port_table / portTable at top level; up: bool; speed: int
    - Integration API v1:  interfaces.ports; state: "UP"/"DOWN"; speedMbps: int; connector: str
    """
    table = (
        device.get("port_table")
        or device.get("portTable")
        or device.get("ports")
        or device.get("interfaces", {}).get("ports", [])
    )
    ports = []
    for p in table:
        idx  = p.get("port_idx") or p.get("portIdx") or p.get("idx") or 0
        name = (p.get("name") or "").strip() or f"Port {idx}"

        # Integration API: state="UP"/"DOWN" — legacy: up=bool / isUp=bool
        state_str = (p.get("state") or "").upper()
        up = bool(p.get("up") or p.get("isUp") or state_str == "UP")

        # Legacy API: flat poe_enable/poe_good/poe_power
        # Integration API v1: nested p["poe"]["enabled"], p["poe"]["standard"], p["poe"]["powerMW"]
        poe_obj    = p.get("poe") if isinstance(p.get("poe"), dict) else {}
        poe_enable = bool(p.get("poe_enable") or p.get("poeEnable") or poe_obj.get("enabled"))
        poe_good   = bool(p.get("poe_good")   or p.get("poeGood")   or (poe_obj.get("outputMW") or 0) > 0)
        poe_power  = float(p.get("poe_power") or p.get("poePower")  or (poe_obj.get("outputMW") or poe_obj.get("powerMW") or 0) / 1000 or 0)
        # Normalize PoE standard: "802.3BT"→"PoE++", "802.3AT"→"PoE+", "802.3AF"→"PoE"
        _poe_std   = (p.get("poe_standard") or poe_obj.get("standard") or "").upper()
        poe_standard = (
            "PoE++" if "BT" in _poe_std or "TYPE4" in _poe_std or "TYPE3" in _poe_std
            else "PoE+" if "AT" in _poe_std or "TYPE2" in _poe_std
            else "PoE"  if _poe_std or poe_enable
            else ""
        )

        # Integration API: speedMbps — legacy: speed / linkSpeed
        speed       = int(p.get("speedMbps") or p.get("speed") or p.get("linkSpeed") or 0)
        full_duplex = bool(p.get("full_duplex") or p.get("fullDuplex"))

        tx_bytes   = int(p.get("tx_bytes")   or p.get("txBytes")   or 0)
        rx_bytes   = int(p.get("rx_bytes")   or p.get("rxBytes")   or 0)
        tx_packets = int(p.get("tx_packets") or p.get("txPackets") or 0)
        rx_packets = int(p.get("rx_packets") or p.get("rxPackets") or 0)
        tx_errors  = int(p.get("tx_errors")  or p.get("txErrors")  or 0)
        rx_errors  = int(p.get("rx_errors")  or p.get("rxErrors")  or 0)

        lldp     = p.get("lldp_table") or p.get("lldpTable") or []
        neighbor = None
        if lldp:
            l = lldp[0] if isinstance(lldp, list) else lldp
            neighbor = {
                "name": l.get("system_name") or l.get("systemName") or l.get("chassis_id") or "",
                "port": l.get("port_id")     or l.get("portId")     or "",
            }

        # Integration API: connector="SFPPLUS"/"SFP28"/etc — legacy: media field
        connector = (p.get("connector") or "").upper()
        media     = (p.get("media") or "").lower()
        sfp = (
            "SFP" in connector
            or "sfp" in media or "fiber" in media
            or bool(p.get("sfp_found") or p.get("sfpFound"))
        )
        is_uplink = bool(p.get("is_uplink") or p.get("isUplink"))
        vlan      = p.get("vlan") or None

        ports.append({
            "idx":         int(idx) if idx else 0,
            "name":        name,
            "up":          up,
            "speed":       speed,
            "full_duplex": full_duplex,
            "poe_enable":   poe_enable,
            "poe_good":     poe_good,
            "poe_power":    poe_power,
            "poe_standard": poe_standard,
            "tx_bytes":    tx_bytes,
            "rx_bytes":    rx_bytes,
            "tx_packets":  tx_packets,
            "rx_packets":  rx_packets,
            "tx_errors":   tx_errors,
            "rx_errors":   rx_errors,
            "neighbor":    neighbor,
            "vlan":        vlan,
            "is_uplink":   is_uplink,
            "sfp":         sfp,
        })
    return sorted(ports, key=lambda x: x["idx"])


async def _full_ports_from_controller(
    base_url: str, api_key: str, site_id: str, device_id: str
) -> list[dict]:
    base    = base_url.rstrip("/")
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=20) as c:
            # Individual device endpoint — handles both direct object and {"data":{...}} wrapper
            r = await c.get(
                f"{base}/proxy/network/integration/v1/sites/{site_id}/devices/{device_id}",
                headers=headers,
            )
            if r.status_code == 200:
                resp = r.json()
                dev  = resp.get("data") if isinstance(resp.get("data"), dict) else resp
                ports = _shape_ports(dev)
                if ports:
                    return ports

            # List endpoint fallback (same path used by _port_maps_from_controller)
            r = await c.get(
                f"{base}/proxy/network/integration/v1/sites/{site_id}/devices",
                headers=headers,
            )
        if r.status_code >= 400:
            return []
        for d in r.json().get("data", []):
            if (d.get("id") or d.get("_id") or "") == device_id:
                ports = _shape_ports(d)
                if ports:
                    return ports
    except Exception:
        pass
    return []


async def _full_ports_from_cloud(host_id: str, device_id: str) -> list[dict]:
    api_key = _api_key()
    if not api_key:
        return []
    try:
        sites = await _connector_list_sites(host_id, api_key)
        async with httpx.AsyncClient(timeout=20) as c:
            for site in sites:
                sid = site.get("id") or ""
                if not sid:
                    continue
                # Individual device endpoint — handles both direct object and {"data":{...}} wrapper
                r = await c.get(
                    f"{UNIFI_CONNECTOR_BASE}/{host_id}/proxy/network/integration/v1/sites/{sid}/devices/{device_id}",
                    headers={"X-API-KEY": api_key, "Accept": "application/json"},
                )
                if r.status_code == 200:
                    resp = r.json()
                    dev  = resp.get("data") if isinstance(resp.get("data"), dict) else resp
                    ports = _shape_ports(dev)
                    if ports:
                        return ports

                # List endpoint fallback for this site
                r = await c.get(
                    f"{UNIFI_CONNECTOR_BASE}/{host_id}/proxy/network/integration/v1/sites/{sid}/devices",
                    headers={"X-API-KEY": api_key, "Accept": "application/json"},
                )
                if r.status_code == 200:
                    for d in r.json().get("data", []):
                        if d.get("id") == device_id:
                            ports = _shape_ports(d)
                            if ports:
                                return ports

        # Final fallback: EA devices API
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(
                f"{UNIFI_EA_BASE}/devices",
                params={"hostIds[]": host_id},
                headers={"X-API-KEY": api_key, "Accept": "application/json"},
            )
        if r.status_code < 400:
            for d in r.json().get("data", []):
                if d.get("id") == device_id:
                    ports = _shape_ports(d)
                    if ports:
                        return ports
    except Exception:
        pass
    return []


@router.get("/sites/{site_id}/devices/{unifi_device_id}/ports")
async def get_device_ports(site_id: int, unifi_device_id: str, db: AsyncSession = Depends(get_db)):
    """Return full port table for a specific UniFi device (live, not cached)."""
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site = site_result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    host_cfg = None
    if site.unifi_host_id:
        hc_result = await db.execute(
            select(UnifiHostConfig).where(UnifiHostConfig.host_id == site.unifi_host_id)
        )
        host_cfg = hc_result.scalar_one_or_none()

    if host_cfg and host_cfg.controller_url and host_cfg.controller_api_key and host_cfg.unifi_site_name:
        ports = await _full_ports_from_controller(
            host_cfg.controller_url, host_cfg.controller_api_key,
            host_cfg.unifi_site_name, unifi_device_id,
        )
    elif site.unifi_host_id:
        ports = await _full_ports_from_cloud(site.unifi_host_id, unifi_device_id)
    else:
        raise HTTPException(status_code=400, detail="No UniFi connection configured for this site.")

    return {"ports": ports, "count": len(ports)}


async def _port_maps_from_controller(
    base_url: str, api_key: str, site_id: str, device_ids: set
) -> dict[str, dict[str, bool]]:
    base = base_url.rstrip("/")
    port_maps: dict[str, dict[str, bool]] = {}
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=20) as c:
            r = await c.get(
                f"{base}/proxy/network/integration/v1/sites/{site_id}/devices",
                headers=headers,
            )
        if r.status_code >= 400:
            return port_maps
        for d in r.json().get("data", []):
            did = d.get("id") or d.get("_id") or ""
            if did not in device_ids:
                continue
            table = d.get("port_table") or d.get("portTable") or d.get("ports") or []
            ports: dict[str, bool] = {}
            for p in table:
                up  = bool(p.get("up") or p.get("isUp"))
                idx = str(p.get("port_idx") or p.get("portIdx") or p.get("idx") or "")
                nm  = (p.get("name") or "").strip()
                if idx: ports[idx] = up
                if nm:  ports[nm.lower()] = up
            port_maps[did] = ports
    except Exception:
        pass
    return port_maps


async def _port_maps_from_cloud(host_id: str, device_ids: set) -> dict[str, dict[str, bool]]:
    api_key = _api_key()
    if not api_key:
        return {}
    port_maps: dict[str, dict[str, bool]] = {}
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(
                f"{UNIFI_EA_BASE}/devices",
                params={"hostIds[]": host_id},
                headers={"X-API-KEY": api_key, "Accept": "application/json"},
            )
        if r.status_code >= 400:
            return port_maps
        for d in r.json().get("data", []):
            if d.get("id") not in device_ids:
                continue
            table = d.get("portTable") or d.get("ports") or []
            ports: dict[str, bool] = {}
            for p in table:
                up  = bool(p.get("up") or p.get("isUp"))
                idx = str(p.get("portIdx") or p.get("idx") or "")
                nm  = (p.get("name") or "").strip()
                if idx: ports[idx] = up
                if nm:  ports[nm.lower()] = up
            port_maps[d["id"]] = ports
    except Exception:
        pass
    return port_maps


# ── Client helpers (legacy stat/sta API — has sw_mac + sw_port per client) ────

def _mac_norm(mac: str) -> str:
    return mac.lower().replace(":", "").replace("-", "")


def _shape_sta_client(c: dict) -> dict:
    oui  = c.get("oui") or ""
    name = c.get("hostname") or oui or (c.get("mac") or "")
    return {
        "name":     name,
        "hostname": c.get("hostname") or "",
        "ip":       c.get("ip") or c.get("last_ip") or "",
        "mac":      (c.get("mac") or "").lower(),
        "type":     "WIRED" if c.get("is_wired") else "WIRELESS",
        "oui":      oui,
        "network":  c.get("network") or c.get("last_connection_network_name") or "",
        "vlan":     c.get("vlan") or None,
    }


async def _get_legacy_site_name(console_id: str, site_uuid: str, api_key: str) -> str | None:
    """Map an Integration API site UUID to its legacy internalReference (e.g. 'default')."""
    sites = await _connector_list_sites(console_id, api_key)
    for s in sites:
        if s.get("id") == site_uuid:
            return s.get("internalReference") or s.get("id")
    return None


async def _fetch_sta_cloud(console_id: str, legacy_site: str, api_key: str) -> list[dict]:
    """Fetch all wired clients via the legacy stat/sta endpoint (cloud proxy)."""
    url     = f"{UNIFI_CONNECTOR_BASE}/{console_id}/proxy/network/api/s/{legacy_site}/stat/sta"
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(url, headers=headers)
        if r.status_code == 200:
            return r.json().get("data", [])
    except Exception:
        pass
    return []


async def _fetch_sta_local(base_url: str, api_key: str, site_name: str) -> list[dict]:
    """Fetch all wired clients via the legacy stat/sta endpoint (local controller)."""
    base    = base_url.rstrip("/")
    url     = f"{base}/proxy/network/api/s/{site_name}/stat/sta"
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30) as c:
            r = await c.get(url, headers=headers)
        if r.status_code == 200:
            return r.json().get("data", [])
    except Exception:
        pass
    return []


async def _load_host_cfg(site: "Site", db: AsyncSession) -> "UnifiHostConfig | None":
    if not site.unifi_host_id:
        return None
    r = await db.execute(select(UnifiHostConfig).where(UnifiHostConfig.host_id == site.unifi_host_id))
    return r.scalar_one_or_none()


async def _get_site_sta(site: "Site", host_cfg: "UnifiHostConfig | None") -> list[dict]:
    """Fetch the legacy stat/sta client list for a portal site."""
    if host_cfg and host_cfg.controller_url and host_cfg.controller_api_key and host_cfg.unifi_site_name:
        return await _fetch_sta_local(
            host_cfg.controller_url, host_cfg.controller_api_key, host_cfg.unifi_site_name
        )
    if not site.unifi_host_id:
        return []
    api_key = _api_key()
    if not api_key:
        return []
    unifi_site = (host_cfg.unifi_site_name if host_cfg else None) or site.unifi_site_name
    if not unifi_site:
        sites_list = await _connector_list_sites(site.unifi_host_id, api_key)
        unifi_site = sites_list[0]["id"] if sites_list else None
    if not unifi_site:
        return []
    legacy = await _get_legacy_site_name(site.unifi_host_id, unifi_site, api_key)
    if not legacy:
        return []
    return await _fetch_sta_cloud(site.unifi_host_id, legacy, api_key)


@router.get("/sites/{site_id}/port-clients")
async def get_port_clients(site_id: int, map_id: int, db: AsyncSession = Depends(get_db)):
    """Return connected clients keyed by seat ID via sw_mac + sw_port matching."""
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site = site_result.scalar_one_or_none()
    if not site:
        return {}

    seats_result = await db.execute(
        select(SeatMapping)
        .where(SeatMapping.floor_map_id == map_id)
        .options(selectinload(SeatMapping.switch))
    )
    seats = seats_result.scalars().all()

    # Build seat keys: (seat_id, mac_norm, port_num_str)
    # Extract trailing port number from port name e.g. "GigabitEthernet1/0/47" → "47"
    seat_keys = []
    for s in seats:
        if not (s.switch and s.switch.mac_address and s.port):
            continue
        nums = re.findall(r"\d+", s.port)
        if not nums:
            continue
        seat_keys.append((str(s.id), _mac_norm(s.switch.mac_address), nums[-1]))

    if not seat_keys:
        return {}

    host_cfg = await _load_host_cfg(site, db)
    raw      = await _get_site_sta(site, host_cfg)
    if not raw:
        return {}

    # Build lookup: (mac_norm, str(sw_port)) → client
    sta_map: dict[tuple, dict] = {}
    for c in raw:
        sw_mac  = _mac_norm(c.get("sw_mac") or "")
        sw_port = c.get("sw_port")
        if sw_mac and sw_port is not None:
            sta_map[(sw_mac, str(sw_port))] = _shape_sta_client(c)

    return {
        seat_id: sta_map[(mac, port)]
        for seat_id, mac, port in seat_keys
        if (mac, port) in sta_map
    }


@router.get("/sites/{site_id}/devices/{unifi_device_id}/clients")
async def get_device_clients(site_id: int, unifi_device_id: str, db: AsyncSession = Depends(get_db)):
    """Return clients on a specific switch keyed by port number string (e.g. '47')."""
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site = site_result.scalar_one_or_none()
    if not site:
        return {}

    dev_result = await db.execute(
        select(UnifiDevice)
        .where(UnifiDevice.site_id == site_id, UnifiDevice.unifi_id == unifi_device_id)
    )
    device = dev_result.scalar_one_or_none()
    if not device or not device.mac:
        return {}

    dev_mac_norm = _mac_norm(device.mac)
    host_cfg     = await _load_host_cfg(site, db)
    raw          = await _get_site_sta(site, host_cfg)
    if not raw:
        return {}

    result: dict[str, dict] = {}
    for c in raw:
        if _mac_norm(c.get("sw_mac") or "") != dev_mac_norm:
            continue
        sw_port = c.get("sw_port")
        if sw_port is not None:
            result[str(sw_port)] = _shape_sta_client(c)

    return result
