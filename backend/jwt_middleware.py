"""
Azure AD JWT validation middleware.
Validates Bearer tokens by calling Microsoft Graph /me — works regardless of
whether the token is v1/v2 format or which audience claim it carries.

Optional: set CHECK_APP_ASSIGNMENT=true in .env to also verify the user is
explicitly assigned to this application in Azure AD (enterprise app assignment).
This is a backend enforcement of Azure's "Assignment required" feature.
"""
import time
import hashlib
import httpx
import os
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# Routes that do NOT require auth
PUBLIC_PATHS = {"/api/health", "/api/settings/branding", "/api/settings/config", "/docs", "/openapi.json", "/redoc"}

# In-memory caches
# token_hash → (expires_at, user_dict)
_token_cache: dict[str, tuple[float, dict]] = {}
# user_id → (expires_at, is_assigned: bool)
_assignment_cache: dict[str, tuple[float, bool]] = {}
# Cached service principal object ID for this app
_sp_object_id: str | None = None

_TOKEN_TTL      = 300   # 5 min — how long we trust a validated token
_ASSIGNMENT_TTL = 900   # 15 min — how long we cache an assignment check


def _cache_get(token: str) -> dict | None:
    key = hashlib.sha256(token.encode()).hexdigest()
    entry = _token_cache.get(key)
    if entry and time.time() < entry[0]:
        return entry[1]
    _token_cache.pop(key, None)
    return None


def _cache_set(token: str, user: dict):
    key = hashlib.sha256(token.encode()).hexdigest()
    _token_cache[key] = (time.time() + _TOKEN_TTL, user)
    if len(_token_cache) > 500:
        now = time.time()
        for k in [k for k, (exp, _) in _token_cache.items() if exp < now]:
            _token_cache.pop(k, None)


async def _get_app_token(tenant_id: str, client_id: str, client_secret: str) -> str | None:
    """Acquire a client-credentials (app-only) token for Microsoft Graph."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
                data={
                    "client_id":     client_id,
                    "client_secret": client_secret,
                    "scope":         "https://graph.microsoft.com/.default",
                    "grant_type":    "client_credentials",
                },
            )
        if r.status_code == 200:
            return r.json().get("access_token")
    except Exception:
        pass
    return None


async def _get_sp_object_id(app_token: str, client_id: str) -> str | None:
    """Resolve the app's client ID to its service principal object ID (cached globally)."""
    global _sp_object_id
    if _sp_object_id:
        return _sp_object_id
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"https://graph.microsoft.com/v1.0/servicePrincipals",
                headers={"Authorization": f"Bearer {app_token}"},
                params={"$filter": f"appId eq '{client_id}'", "$select": "id"},
            )
        if r.status_code == 200:
            values = r.json().get("value", [])
            if values:
                _sp_object_id = values[0]["id"]
                return _sp_object_id
    except Exception:
        pass
    return None


async def _is_assigned_to_app(user_id: str, app_token: str, sp_id: str) -> bool:
    """Check if the user has an app role assignment for this service principal."""
    # Check cache
    entry = _assignment_cache.get(user_id)
    if entry and time.time() < entry[0]:
        return entry[1]

    assigned = False
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"https://graph.microsoft.com/v1.0/servicePrincipals/{sp_id}/appRoleAssignedTo",
                headers={"Authorization": f"Bearer {app_token}"},
                params={"$filter": f"principalId eq '{user_id}'", "$select": "id"},
            )
        assigned = r.status_code == 200 and len(r.json().get("value", [])) > 0
    except Exception:
        assigned = False

    _assignment_cache[user_id] = (time.time() + _ASSIGNMENT_TTL, assigned)
    return assigned


class AzureJWTMiddleware(BaseHTTPMiddleware):
    """Validate every /api/* request carries a valid Azure AD token, except public paths.
    Token validity is verified by calling Graph /me.

    If CHECK_APP_ASSIGNMENT=true in .env, additionally verifies the user is assigned
    to this application in Azure AD before granting access."""

    def __init__(self, app, enabled: bool = True):
        super().__init__(app)
        self.enabled = enabled

    async def dispatch(self, request, call_next):
        if not self.enabled:
            load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)
            dev_email = os.getenv("DEV_USER_EMAIL", "")
            dev_name  = os.getenv("DEV_USER_NAME", "Dev User")
            parts     = dev_name.split(" ", 1)
            request.state.user = {
                "id":         f"dev-{dev_email}" if dev_email else "dev-anonymous",
                "first_name": parts[0],
                "last_name":  parts[1] if len(parts) > 1 else "",
                "email":      dev_email,
            }
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/") or path in PUBLIC_PATHS:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"detail": "Missing or invalid Authorization header"})

        token = auth_header.removeprefix("Bearer ").strip()

        # Serve from cache if still valid
        cached = _cache_get(token)
        if cached:
            request.state.user = cached
            return await call_next(request)

        # Verify identity via Graph /me
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://graph.microsoft.com/v1.0/me",
                    headers={"Authorization": f"Bearer {token}"},
                )
            if r.status_code == 401:
                return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
            if r.status_code != 200:
                return JSONResponse(status_code=503, content={"detail": f"Auth service error: Graph returned {r.status_code}"})

            me = r.json()
            user = {
                "id":         me.get("id"),
                "first_name": me.get("givenName") or "",
                "last_name":  me.get("surname") or "",
                "email":      me.get("mail") or me.get("userPrincipalName") or "",
            }
        except Exception as e:
            return JSONResponse(status_code=503, content={"detail": f"Auth service error: {e}"})

        # Optional: enforce Azure AD app assignment
        check_assignment = os.getenv("CHECK_APP_ASSIGNMENT", "false").lower() == "true"
        if check_assignment and user.get("id"):
            tenant_id     = os.getenv("AZURE_TENANT_ID", "")
            client_id     = os.getenv("AZURE_CLIENT_ID", "")
            client_secret = os.getenv("AZURE_CLIENT_SECRET", "")

            if tenant_id and client_id and client_secret:
                app_token = await _get_app_token(tenant_id, client_id, client_secret)
                if app_token:
                    sp_id = await _get_sp_object_id(app_token, client_id)
                    if sp_id:
                        assigned = await _is_assigned_to_app(user["id"], app_token, sp_id)
                        if not assigned:
                            return JSONResponse(
                                status_code=403,
                                content={"detail": "You are not assigned to this application. Contact your administrator."},
                            )

        _cache_set(token, user)
        request.state.user = user
        return await call_next(request)
