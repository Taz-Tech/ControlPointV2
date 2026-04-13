import os
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/intune", tags=["intune"])

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def _cfg():
    return {
        "tenant_id":     os.getenv("INTUNE_TENANT_ID", "").strip(),
        "client_id":     os.getenv("INTUNE_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("INTUNE_CLIENT_SECRET", "").strip(),
    }


def is_intune_configured() -> bool:
    c = _cfg()
    return all([c["tenant_id"], c["client_id"], c["client_secret"]])


async def _get_intune_token() -> str:
    c = _cfg()
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
        raise HTTPException(status_code=502, detail=f"Failed to acquire Intune token: {r.text[:300]}")
    token = r.json().get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="Intune token response missing access_token")
    return token


def _shape_device(d: dict) -> dict:
    return {
        "id":                  d.get("id"),
        "name":                d.get("deviceName"),
        "userDisplayName":     d.get("userDisplayName"),
        "userPrincipalName":   d.get("userPrincipalName"),
        "operatingSystem":     d.get("operatingSystem"),
        "osVersion":           d.get("osVersion"),
        "manufacturer":        d.get("manufacturer"),
        "model":               d.get("model"),
        "serialNumber":        d.get("serialNumber"),
        "imei":                d.get("imei"),
        "complianceState":     d.get("complianceState"),
        "managementState":     d.get("managementState"),
        "enrolledDateTime":    d.get("enrolledDateTime"),
        "lastSyncDateTime":    d.get("lastSyncDateTime"),
        "isEncrypted":         d.get("isEncrypted"),
        "isSupervised":        d.get("isSupervised"),
        "azureADRegistered":   d.get("azureADRegistered"),
        "managedDeviceOwnerType": d.get("managedDeviceOwnerType"),
    }


@router.get("/devices")
async def get_devices(
    os_filter: str | None = Query(default=None, description="Filter by OS (e.g. Windows, iOS, Android, macOS)"),
    compliance: str | None = Query(default=None, description="Filter by compliance state (compliant, noncompliant, unknown)"),
):
    """List all Intune managed devices, with optional OS and compliance filters."""
    if not is_intune_configured():
        raise HTTPException(status_code=503, detail="Intune credentials not configured.")

    token = await _get_intune_token()
    headers = {"Authorization": f"Bearer {token}"}

    all_devices: list[dict] = []
    url = f"{GRAPH_BASE}/deviceManagement/managedDevices"

    async with httpx.AsyncClient(timeout=60) as client:
        while url:
            r = await client.get(
                url,
                headers=headers,
                params={"$top": 999} if "?" not in url else {},
            )
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])

            data = r.json()
            all_devices.extend(data.get("value", []))
            url = data.get("@odata.nextLink")

    shaped = [_shape_device(d) for d in all_devices]

    if os_filter:
        os_lower = os_filter.lower()
        shaped = [d for d in shaped if (d.get("operatingSystem") or "").lower() == os_lower]

    if compliance:
        shaped = [d for d in shaped if (d.get("complianceState") or "").lower() == compliance.lower()]

    return {"count": len(shaped), "devices": shaped}


@router.get("/devices/{device_id}")
async def get_device(device_id: str):
    """Get details for a single Intune managed device."""
    if not is_intune_configured():
        raise HTTPException(status_code=503, detail="Intune credentials not configured.")

    token = await _get_intune_token()

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{GRAPH_BASE}/deviceManagement/managedDevices/{device_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

    if r.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found in Intune.")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])

    return _shape_device(r.json())


@router.get("/stats")
async def get_stats():
    """Summary counts: total, by OS, by compliance state."""
    if not is_intune_configured():
        raise HTTPException(status_code=503, detail="Intune credentials not configured.")

    token = await _get_intune_token()
    headers = {"Authorization": f"Bearer {token}"}

    all_devices: list[dict] = []
    url = f"{GRAPH_BASE}/deviceManagement/managedDevices"

    async with httpx.AsyncClient(timeout=60) as client:
        while url:
            r = await client.get(
                url,
                headers=headers,
                params={"$top": 999, "$select": "operatingSystem,complianceState"} if "?" not in url else {},
            )
            if r.status_code >= 400:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            data = r.json()
            all_devices.extend(data.get("value", []))
            url = data.get("@odata.nextLink")

    by_os: dict[str, int] = {}
    by_compliance: dict[str, int] = {}

    for d in all_devices:
        os_key = d.get("operatingSystem") or "Unknown"
        by_os[os_key] = by_os.get(os_key, 0) + 1

        comp_key = d.get("complianceState") or "unknown"
        by_compliance[comp_key] = by_compliance.get(comp_key, 0) + 1

    return {
        "total":        len(all_devices),
        "byOS":         by_os,
        "byCompliance": by_compliance,
    }
