import os
import httpx
from urllib.parse import urlencode
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import RedirectResponse, Response
from jose import jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import DirectoryUser

router = APIRouter(prefix="/api/auth", tags=["auth"])

PORTAL_JWT_ALGO   = "HS256"
PORTAL_JWT_ISSUER = "controlpoint"


def _portal_url() -> str:
    for o in os.getenv("ALLOWED_ORIGINS", "").split(","):
        o = o.strip()
        if o.startswith("https://"):
            return o.rstrip("/")
    return "http://localhost:5173"


def _portal_jwt_secret() -> str:
    return os.getenv("PORTAL_JWT_SECRET", "insecure-dev-secret-change-me")


def _okta_base(domain: str) -> str:
    domain = domain.strip().rstrip("/").removeprefix("https://").removeprefix("http://")
    return f"https://{domain}"


def issue_portal_token(user_id: str, email: str, first_name: str, last_name: str) -> str:
    now = datetime.utcnow()
    return jose_jwt.encode(
        {
            "iss":        PORTAL_JWT_ISSUER,
            "sub":        user_id,
            "email":      email,
            "first_name": first_name,
            "last_name":  last_name,
            "iat":        int(now.timestamp()),
            "exp":        int((now + timedelta(hours=8)).timestamp()),
        },
        _portal_jwt_secret(),
        algorithm=PORTAL_JWT_ALGO,
    )


def _clean_cert(cert: str) -> str:
    """Strip PEM headers and whitespace — python3-saml expects raw base64."""
    for header in ("-----BEGIN CERTIFICATE-----", "-----END CERTIFICATE-----"):
        cert = cert.replace(header, "")
    return cert.strip().replace("\n", "").replace("\r", "").replace(" ", "")


def _saml_settings(portal_url: str) -> dict:
    return {
        "strict":   os.getenv("SAML_STRICT", "true").lower() != "false",
        "debug":    os.getenv("SAML_DEBUG",  "false").lower() == "true",
        "security": {"clockDrift": 300},
        "sp": {
            "entityId": f"{portal_url}/api/auth/saml/metadata",
            "assertionConsumerService": {
                "url":     f"{portal_url}/api/auth/saml/acs",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "x509cert":  "",
            "privateKey": "",
        },
        "idp": {
            "entityId": os.getenv("OKTA_SAML_IDP_ENTITY_ID", "").strip(),
            "singleSignOnService": {
                "url":     os.getenv("OKTA_SAML_IDP_SSO_URL", "").strip(),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": _clean_cert(os.getenv("OKTA_SAML_IDP_CERT", "")),
        },
    }


def _build_saml_request(request: Request, post_data: dict | None = None) -> dict:
    url = request.url
    return {
        "https":       "on" if url.scheme == "https" else "off",
        "http_host":   request.headers.get("host", url.netloc),
        "script_name": url.path,
        "server_port": str(url.port or (443 if url.scheme == "https" else 80)),
        "get_data":    dict(request.query_params),
        "post_data":   post_data or {},
    }


@router.get("/sso-providers")
async def sso_providers():
    """Return configured SSO providers for the login page. Public — no auth required."""
    providers = []

    # SAML takes priority when the IdP SSO URL is set
    idp_sso_url = os.getenv("OKTA_SAML_IDP_SSO_URL", "").strip()
    if idp_sso_url:
        providers.append({"id": "okta", "name": "SSO", "auth_url": idp_sso_url})
    else:
        # OIDC fallback (when SAML is not configured)
        domain    = os.getenv("OKTA_DOMAIN",    "").strip()
        client_id = os.getenv("OKTA_CLIENT_ID", "").strip()
        if domain and client_id:
            redirect_uri = f"{_portal_url()}/api/auth/okta/callback"
            auth_url = (
                f"{_okta_base(domain)}/oauth2/v1/authorize?"
                + urlencode({
                    "client_id":     client_id,
                    "response_type": "code",
                    "scope":         "openid profile email",
                    "redirect_uri":  redirect_uri,
                    "state":         "okta",
                })
            )
            providers.append({"id": "okta", "name": "SSO", "auth_url": auth_url})

    return {"providers": providers}


async def _enrich_directory_user(db: AsyncSession, email: str, okta_sub: str) -> None:
    """Fetch full Okta profile via Management API and upsert into DirectoryUser."""
    domain    = os.getenv("OKTA_DOMAIN", "").strip().rstrip("/").removeprefix("https://").removeprefix("http://")
    api_token = os.getenv("OKTA_API_TOKEN", "").strip()
    now       = datetime.now(timezone.utc).isoformat()

    okta_status           = None
    okta_login            = email
    okta_last_login       = None
    okta_password_changed = None

    if domain and api_token and okta_sub:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(
                    f"https://{domain}/api/v1/users/{okta_sub}",
                    headers={"Authorization": f"SSWS {api_token}", "Accept": "application/json"},
                )
            if r.status_code == 200:
                u                     = r.json()
                profile               = u.get("profile") or {}
                okta_status           = u.get("status")
                okta_last_login       = u.get("lastLogin")
                okta_password_changed = u.get("passwordChanged")
                okta_login            = profile.get("login") or email
        except Exception:
            pass

    result   = await db.execute(select(DirectoryUser).where(DirectoryUser.email == email))
    dir_user = result.scalar_one_or_none()

    if dir_user:
        dir_user.okta_id               = okta_sub
        dir_user.okta_login            = okta_login
        dir_user.okta_status           = okta_status
        dir_user.okta_last_login       = okta_last_login
        dir_user.okta_password_changed = okta_password_changed
        dir_user.okta_synced_at        = now
        await db.commit()


@router.get("/okta/callback")
async def okta_callback(code: str, state: str = "", db: AsyncSession = Depends(get_db)):
    domain        = os.getenv("OKTA_DOMAIN",        "").strip()
    client_id     = os.getenv("OKTA_CLIENT_ID",     "").strip()
    client_secret = os.getenv("OKTA_CLIENT_SECRET", "").strip()

    if not all([domain, client_id, client_secret]):
        raise HTTPException(status_code=503, detail="Okta OIDC not configured — set OKTA_DOMAIN, OKTA_CLIENT_ID, and OKTA_CLIENT_SECRET.")

    base         = _okta_base(domain)
    redirect_uri = f"{_portal_url()}/api/auth/okta/callback"

    # Exchange authorization code for tokens
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{base}/oauth2/v1/token",
            data={
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  redirect_uri,
                "client_id":     client_id,
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
        )

    if r.status_code != 200:
        raise HTTPException(status_code=401, detail=f"Okta token exchange failed: {r.text[:200]}")

    access_token = r.json().get("access_token", "")
    if not access_token:
        raise HTTPException(status_code=401, detail="No access_token in Okta response")

    # Fetch user info
    async with httpx.AsyncClient(timeout=10) as c:
        r2 = await c.get(
            f"{base}/oauth2/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )

    if r2.status_code != 200:
        raise HTTPException(status_code=401, detail="Could not fetch Okta user info")

    info       = r2.json()
    okta_sub   = info.get("sub", "")
    email      = (info.get("email") or "").lower().strip()
    first_name = info.get("given_name") or (info.get("name") or "").split(" ")[0]
    last_name  = info.get("family_name") or ""
    user_id    = f"okta-{okta_sub}" if okta_sub else f"okta-{email}"

    # Upsert user in portal DB
    from .settings import _upsert_user
    await _upsert_user(db, user_id, first_name, last_name, email)

    # Match to DirectoryUser and write Okta profile fields
    await _enrich_directory_user(db, email, okta_sub)

    # Issue a portal session JWT and redirect the browser back to the SPA
    token = issue_portal_token(user_id, email, first_name, last_name)
    return RedirectResponse(url=f"{_portal_url()}/#token={token}", status_code=302)


# ── SAML 2.0 endpoints ────────────────────────────────────────────────────────

@router.post("/saml/acs")
async def saml_acs(
    request:      Request,
    SAMLResponse: str          = Form(...),
    RelayState:   str          = Form(default=""),
    db:           AsyncSession = Depends(get_db),
):
    """SAML Assertion Consumer Service — Okta POSTs the signed assertion here."""
    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    portal_url = _portal_url()
    settings   = _saml_settings(portal_url)

    missing = [k for k, v in {
        "OKTA_SAML_IDP_SSO_URL":   settings["idp"]["singleSignOnService"]["url"],
        "OKTA_SAML_IDP_ENTITY_ID": settings["idp"]["entityId"],
        "OKTA_SAML_IDP_CERT":      settings["idp"]["x509cert"],
    }.items() if not v]
    if missing:
        raise HTTPException(status_code=503, detail=f"SAML not configured — missing: {', '.join(missing)}")

    req  = _build_saml_request(request, {"SAMLResponse": SAMLResponse, "RelayState": RelayState})
    auth = OneLogin_Saml2_Auth(req, settings)
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason() or ", ".join(errors)
        raise HTTPException(status_code=401, detail=f"SAML validation failed: {reason}")

    if not auth.is_authenticated():
        raise HTTPException(status_code=401, detail="SAML authentication failed")

    name_id    = auth.get_nameid() or ""
    attributes = auth.get_attributes()

    def _attr(simple: str, urn: str) -> str:
        vals = attributes.get(simple) or attributes.get(urn) or []
        return vals[0] if vals else ""

    email = (
        name_id.lower().strip()
        if "@" in name_id
        else _attr("email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress").lower().strip()
    )
    if not email:
        raise HTTPException(status_code=401, detail="SAML assertion did not contain an email address")

    first_name = _attr("firstName", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname")
    last_name  = _attr("lastName",  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname")
    user_id    = f"saml-{email}"

    from .settings import _upsert_user
    await _upsert_user(db, user_id, first_name, last_name, email)

    token = issue_portal_token(user_id, email, first_name, last_name)
    return RedirectResponse(url=f"{portal_url}/#token={token}", status_code=302)


@router.get("/saml/metadata")
async def saml_metadata():
    """SP metadata XML — give Okta this URL when setting up the SAML app."""
    from onelogin.saml2.settings import OneLogin_Saml2_Settings

    settings    = _saml_settings(_portal_url())
    sp_settings = OneLogin_Saml2_Settings(settings=settings, sp_validation_only=True)
    metadata    = sp_settings.get_sp_metadata()
    errors      = sp_settings.validate_metadata(metadata)
    if errors:
        raise HTTPException(status_code=500, detail=f"SP metadata error: {errors}")
    return Response(content=metadata, media_type="application/xml")
