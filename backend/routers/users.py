from fastapi import APIRouter, HTTPException, Query
import httpx
from ..auth import get_graph_token, is_azure_configured

router = APIRouter(prefix="/api/users", tags=["users"])

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

USER_SELECT = (
    "displayName,givenName,surname,mail,userPrincipalName,"
    "jobTitle,department,officeLocation,mobilePhone,"
    "businessPhones,usageLocation,accountEnabled,id,"
    "city,state,country,streetAddress,postalCode,companyName,employeeId,employeeType"
)


async def _graph_get(path: str, params: dict = None) -> dict:
    token = get_graph_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{GRAPH_BASE}{path}", headers=headers, params=params)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get("/search")
async def search_users(q: str = Query(..., min_length=1)):
    if not is_azure_configured():
        raise HTTPException(
            status_code=503,
            detail="Azure credentials not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in .env",
        )

    filter_expr = (
        f"startswith(displayName,'{q}') or "
        f"startswith(mail,'{q}') or "
        f"startswith(userPrincipalName,'{q}')"
    )
    data = await _graph_get(
        "/users",
        params={"$filter": filter_expr, "$select": USER_SELECT, "$top": "25"},
    )
    return {"users": data.get("value", [])}


@router.get("/{user_id}")
async def get_user_detail(user_id: str):
    if not is_azure_configured():
        raise HTTPException(status_code=503, detail="Azure credentials not configured.")

    user = await _graph_get(f"/users/{user_id}", params={"$select": USER_SELECT})

    # Fetch licenses
    licenses_data = await _graph_get(f"/users/{user_id}/licenseDetails")
    licenses = [lic.get("skuPartNumber", "Unknown") for lic in licenses_data.get("value", [])]

    # Fetch groups
    groups_data = await _graph_get(
        f"/users/{user_id}/memberOf",
        params={"$select": "displayName,id", "$top": "50"},
    )
    groups = [g.get("displayName") for g in groups_data.get("value", []) if g.get("displayName")]

    # Manager
    manager = None
    try:
        mgr_data = await _graph_get(
            f"/users/{user_id}/manager",
            params={"$select": "displayName,mail,jobTitle,id"},
        )
        manager = {
            "displayName": mgr_data.get("displayName"),
            "mail":        mgr_data.get("mail"),
            "jobTitle":    mgr_data.get("jobTitle"),
            "id":          mgr_data.get("id"),
        }
    except Exception:
        pass

    # Direct reports count
    direct_reports = []
    try:
        dr_data = await _graph_get(
            f"/users/{user_id}/directReports",
            params={"$select": "displayName,jobTitle,mail,id", "$top": "50"},
        )
        direct_reports = [
            {"displayName": r.get("displayName"), "jobTitle": r.get("jobTitle"), "mail": r.get("mail"), "id": r.get("id")}
            for r in dr_data.get("value", [])
        ]
    except Exception:
        pass

    # Sign-in activity (requires AuditLog.Read.All)
    sign_in = None
    try:
        sign_in_data = await _graph_get(
            f"/users/{user_id}",
            params={"$select": "signInActivity"},
        )
        sign_in = sign_in_data.get("signInActivity")
    except Exception:
        pass

    return {
        **user,
        "licenses":      licenses,
        "groups":        groups,
        "manager":       manager,
        "directReports": direct_reports,
        "signInActivity": sign_in,
    }
