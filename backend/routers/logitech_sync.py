import os
import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/logitech", tags=["logitech"])

LOGITECH_API_BASE = "https://api.sync.logitech.com"

# Projection that returns full place info + device details
_PLACE_PROJECTION = "place.info,place.device,place.device.info,place.device.status,place.device.warranty,place.device.sensors"


def _cfg():
    return {
        "cert_path": os.getenv("LOGITECH_SYNC_CERT_PATH", "").strip(),
        "key_path":  os.getenv("LOGITECH_SYNC_KEY_PATH", "").strip(),
        "org_id":    os.getenv("LOGITECH_SYNC_ORG_ID", "").strip(),
    }


def is_logitech_configured() -> bool:
    c = _cfg()
    if not all([c["cert_path"], c["key_path"], c["org_id"]]):
        return False
    return os.path.isfile(c["cert_path"]) and os.path.isfile(c["key_path"])


def _make_client(timeout: int = 30) -> httpx.AsyncClient:
    """Return an httpx client configured for mTLS using the cert + private key."""
    c = _cfg()
    return httpx.AsyncClient(
        cert=(c["cert_path"], c["key_path"]),
        timeout=timeout,
    )


async def _get_all_places(rooms: bool = True, desks: bool = False) -> list[dict]:
    if not is_logitech_configured():
        raise HTTPException(status_code=503, detail="Logitech Sync credentials not configured.")

    c = _cfg()
    params: dict = {"projection": _PLACE_PROJECTION}
    if rooms:
        params["rooms"] = "true"
    if desks:
        params["desks"] = "true"

    all_places: list[dict] = []

    async with _make_client() as client:
        continuation: str | None = None
        while True:
            if continuation:
                params["continuation"] = continuation

            r = await client.get(
                f"{LOGITECH_API_BASE}/v1/org/{c['org_id']}/place",
                params=params,
            )
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])

            data = r.json()
            batch = data.get("places") or []
            all_places.extend(batch)

            continuation = data.get("continuation")
            if not continuation:
                break

    return all_places


def _shape_room(p: dict) -> dict:
    return {
        "id":          p.get("id"),
        "name":        p.get("name"),
        "type":        p.get("type"),
        "group":       p.get("group"),
        "location":    p.get("location"),
        "capacity":    p.get("seatCount"),
        "deviceCount": len(p.get("devices") or []),
    }


def _shape_device(d: dict, place_id: str = "", place_name: str = "") -> dict:
    network     = d.get("network") or {}
    warranty    = d.get("warranty") or {}
    sensors     = d.get("sensors") or {}
    peripherals = d.get("peripherals") or {}

    return {
        "id":           d.get("id"),
        "name":         d.get("name"),
        "type":         d.get("type"),
        "serialNumber": d.get("serial"),
        "firmware":     d.get("version"),
        "status":       d.get("status"),
        "healthStatus": d.get("healthStatus"),
        "lastSeen":     d.get("lastSeen"),
        "createdAt":    d.get("createdAt"),
        "ip":           network.get("ip"),
        "mac":          network.get("mac"),
        "hostName":     network.get("hostName"),
        "wired":        network.get("wired"),
        "wireless":     network.get("wireless"),
        "warranty": {
            "type":      warranty.get("type"),
            "expiresAt": warranty.get("expiresAt"),
        } if warranty else None,
        "sensors": {
            "latestTs":    sensors.get("latestTs"),
            "co2":         sensors.get("co2"),
            "temperature": sensors.get("temperature"),
            "humidity":    sensors.get("humidity"),
            "tvoc":        sensors.get("tvoc"),
            "pm25":        sensors.get("pm25"),
            "presence":    sensors.get("presence"),
        } if sensors else None,
        "peripherals":  peripherals if peripherals else None,
        "spaceId":      place_id,
        "spaceName":    place_name,
    }


@router.get("/rooms")
async def get_rooms():
    """List all Logitech Sync rooms/places in the org."""
    places = await _get_all_places(rooms=True)
    return {
        "count": len(places),
        "rooms": [_shape_room(p) for p in places],
    }


@router.get("/rooms/{room_id}/devices")
async def get_room_devices(room_id: str):
    """List all devices assigned to a specific room."""
    places = await _get_all_places(rooms=True)
    match = next((p for p in places if p.get("id") == room_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found.")

    devices = [
        _shape_device(d, place_id=match["id"], place_name=match.get("name", ""))
        for d in (match.get("devices") or [])
    ]
    return {
        "roomId":  room_id,
        "count":   len(devices),
        "devices": devices,
    }


@router.get("/devices")
async def get_all_devices():
    """List all devices across the entire org, grouped by room."""
    places = await _get_all_places(rooms=True)

    rooms_out = []
    total = 0
    for p in places:
        raw_devices = p.get("devices") or []
        shaped = [_shape_device(d, place_id=p["id"], place_name=p.get("name", "")) for d in raw_devices]
        total += len(shaped)
        rooms_out.append({
            "roomId":   p["id"],
            "roomName": p.get("name", ""),
            "capacity": p.get("seatCount"),
            "devices":  shaped,
        })

    return {
        "totalDevices": total,
        "totalRooms":   len(rooms_out),
        "rooms":        rooms_out,
    }
