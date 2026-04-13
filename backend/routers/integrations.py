import os
import re
import uuid
import base64
import httpx
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from pydantic import BaseModel
from dotenv import load_dotenv
from jose import jwt as jose_jwt

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

ENV_PATH  = Path(__file__).parent.parent / ".env"
CERTS_DIR = Path(__file__).parent.parent / "certs"
CERTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Integration definitions ───────────────────────────────────────────────────

INTEGRATIONS = {
    "microsoft365": {
        "id":          "microsoft365",
        "name":        "Microsoft 365",
        "description": "Azure AD & Graph API — powers User Lookup, Shared Mailboxes, and authentication.",
        "icon":        "☁️",
        "docs_url":    "https://portal.azure.com",
        "fields": [
            {"key": "AZURE_TENANT_ID",     "label": "Tenant ID",     "secret": False},
            {"key": "AZURE_CLIENT_ID",     "label": "Client ID",     "secret": False},
            {"key": "AZURE_CLIENT_SECRET", "label": "Client Secret", "secret": True},
        ],
    },
    "freshservice": {
        "id":          "freshservice",
        "name":        "Freshservice",
        "description": "IT service management — powers ticket lookup and creation.",
        "icon":        "🎫",
        "docs_url":    "https://api.freshservice.com",
        "fields": [
            {"key": "FRESHSERVICE_DOMAIN",  "label": "Domain",  "secret": False, "placeholder": "company.freshservice.com"},
            {"key": "FRESHSERVICE_API_KEY", "label": "API Key", "secret": True},
        ],
    },
    "immybot": {
        "id":          "immybot",
        "name":        "ImmyBot",
        "description": "Endpoint management — powers device lookup and computer management.",
        "icon":        "🤖",
        "docs_url":    "https://docs.immy.bot",
        "fields": [
            {"key": "IMMYBOT_BASE_URL",     "label": "Base URL",      "secret": False, "placeholder": "https://company.immy.bot"},
            {"key": "IMMYBOT_CLIENT_ID",    "label": "Client ID",     "secret": False},
            {"key": "IMMYBOT_CLIENT_SECRET","label": "Client Secret", "secret": True},
            {"key": "IMMYBOT_TENANT_ID",    "label": "Tenant ID",     "secret": False},
            {"key": "IMMYBOT_APP_ID",       "label": "App ID",        "secret": False, "placeholder": "https://company.immy.bot"},
        ],
    },
    "arcticwolf": {
        "id":          "arcticwolf",
        "name":        "Arctic Wolf Aurora (Cylance)",
        "description": "Cylance/Aurora EDR — pulls security alerts, threats, and device observations.",
        "icon":        "🐺",
        "docs_url":    "https://docs.arcticwolf.com/bundle/Aurora-User-API-guide/page/",
        "fields": [
            {"key": "CYLANCE_TENANT_ID",  "label": "Tenant ID",           "secret": False},
            {"key": "CYLANCE_APP_ID",     "label": "Application ID",      "secret": False},
            {"key": "CYLANCE_APP_SECRET", "label": "Application Secret",  "secret": True},
        ],
    },
    "logitech_sync": {
        "id":          "logitech_sync",
        "name":        "Logitech Sync",
        "description": "Logitech Sync Portal — pulls meeting room spaces and their assigned devices.",
        "icon":        "📹",
        "docs_url":    "https://developer.logitech.com/en-us/sync/",
        "fields": [
            {"key": "LOGITECH_SYNC_CERT_PATH", "label": "Client Certificate", "secret": False, "type": "file", "upload_url": "/api/integrations/logitech_sync/upload-cert", "accept": ".pem,.crt,.cer"},
            {"key": "LOGITECH_SYNC_KEY_PATH",  "label": "Private Key",        "secret": False, "type": "file", "upload_url": "/api/integrations/logitech_sync/upload-key",  "accept": ".pem,.key"},
            {"key": "LOGITECH_SYNC_ORG_ID",    "label": "Org ID",             "secret": False},
        ],
    },
    "intune": {
        "id":          "intune",
        "name":        "Microsoft Intune",
        "description": "Microsoft Intune MDM — pulls managed device inventory, compliance states, and OS breakdown.",
        "icon":        "💻",
        "docs_url":    "https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice",
        "fields": [
            {"key": "INTUNE_TENANT_ID",     "label": "Tenant ID",     "secret": False},
            {"key": "INTUNE_CLIENT_ID",     "label": "Client ID",     "secret": False},
            {"key": "INTUNE_CLIENT_SECRET", "label": "Client Secret", "secret": True},
        ],
    },
    "ringcentral": {
        "id":          "ringcentral",
        "name":        "RingCentral",
        "description": "RingCentral telephony — monitor user presence and manage DND status across teams.",
        "icon":        "📞",
        "docs_url":    "https://developers.ringcentral.com",
        "fields": [
            {"key": "RC_CLIENT_ID",     "label": "Client ID",     "secret": False},
            {"key": "RC_CLIENT_SECRET", "label": "Client Secret", "secret": True},
            {"key": "RC_JWT",           "label": "JWT Token",     "secret": True,  "placeholder": "Private app JWT from RingCentral Developer Console"},
        ],
    },
}

MASK = "••••••••"


# ── .env helpers ──────────────────────────────────────────────────────────────

def _read_env_raw() -> dict[str, str]:
    """Return all key=value pairs from .env, preserving raw values."""
    result: dict[str, str] = {}
    if not ENV_PATH.exists():
        return result
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            result[k.strip()] = v.strip()
    return result


def _write_env_keys(updates: dict[str, str]):
    """Update specific keys in .env, preserving all other lines and comments."""
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    updated: set[str] = set()
    new_lines: list[str] = []

    for line in lines:
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if m and m.group(1) in updates:
            key = m.group(1)
            new_lines.append(f"{key}={updates[key]}")
            updated.add(key)
        else:
            new_lines.append(line)

    for key, val in updates.items():
        if key not in updated:
            new_lines.append(f"{key}={val}")

    ENV_PATH.write_text("\n".join(new_lines) + "\n")
    load_dotenv(dotenv_path=ENV_PATH, override=True)
    # Also push directly into os.environ so cached callers see the update immediately
    for key, val in updates.items():
        os.environ[key] = val


def _is_configured(integration_id: str) -> bool:
    raw = _read_env_raw()
    return all(
        raw.get(f["key"], "").strip()
        for f in INTEGRATIONS[integration_id]["fields"]
    )


# ── Schemas ───────────────────────────────────────────────────────────────────

class IntegrationUpdate(BaseModel):
    values: dict[str, str]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_integrations():
    raw = _read_env_raw()
    result = []
    for intg in INTEGRATIONS.values():
        fields_out = []
        for f in intg["fields"]:
            current = raw.get(f["key"], "")
            fields_out.append({
                **f,
                "value": MASK if (f["secret"] and current) else current,
            })
        result.append({
            "id":          intg["id"],
            "name":        intg["name"],
            "description": intg["description"],
            "icon":        intg["icon"],
            "docs_url":    intg["docs_url"],
            "configured":  all(raw.get(f["key"], "").strip() for f in intg["fields"]),
            "fields":      fields_out,
        })
    return result


@router.put("/{integration_id}")
async def update_integration(integration_id: str, body: IntegrationUpdate):
    if integration_id not in INTEGRATIONS:
        raise HTTPException(status_code=404, detail="Integration not found")

    raw = _read_env_raw()
    updates: dict[str, str] = {}

    for f in INTEGRATIONS[integration_id]["fields"]:
        key = f["key"]
        new_val = body.values.get(key, "").strip()
        # Keep existing secret if the user left it masked or empty
        if f["secret"] and (not new_val or new_val == MASK):
            continue
        if new_val:
            updates[key] = new_val

    if updates:
        _write_env_keys(updates)

    # Return updated state
    raw2 = _read_env_raw()
    intg = INTEGRATIONS[integration_id]
    fields_out = [
        {**f, "value": MASK if (f["secret"] and raw2.get(f["key"])) else raw2.get(f["key"], "")}
        for f in intg["fields"]
    ]
    return {
        "id": integration_id,
        "configured": all(raw2.get(f["key"], "").strip() for f in intg["fields"]),
        "fields": fields_out,
    }


@router.post("/{integration_id}/test")
async def test_integration(integration_id: str):
    if integration_id not in INTEGRATIONS:
        raise HTTPException(status_code=404, detail="Integration not found")

    raw = _read_env_raw()

    try:
        if integration_id == "microsoft365":
            return await _test_microsoft365(raw)
        if integration_id == "freshservice":
            return await _test_freshservice(raw)
        if integration_id == "immybot":
            return await _test_immybot(raw)
        if integration_id == "arcticwolf":
            return await _test_arcticwolf(raw)
        if integration_id == "logitech_sync":
            return await _test_logitech_sync(raw)
        if integration_id == "intune":
            return await _test_intune(raw)
        if integration_id == "ringcentral":
            return await _test_ringcentral(raw)
    except Exception as e:
        return {"success": False, "message": str(e)}

    return {"success": False, "message": "Unknown integration"}


# ── Certificate upload ────────────────────────────────────────────────────────

ALLOWED_CERT_EXTENSIONS = {".pem", ".crt", ".cer"}
ALLOWED_KEY_EXTENSIONS  = {".pem", ".key"}


def _validate_pem(content: bytes, expect: str) -> str | None:
    """Return an error string if content doesn't look like the expected PEM type, else None."""
    text = content.decode("utf-8", errors="ignore")
    if expect == "cert" and "-----BEGIN CERTIFICATE-----" not in text:
        return "File does not appear to be a valid PEM certificate (missing BEGIN CERTIFICATE header)."
    if expect == "key" and "PRIVATE KEY-----" not in text:
        return "File does not appear to be a valid PEM private key (missing PRIVATE KEY header)."
    return None


@router.post("/logitech_sync/upload-cert")
async def upload_logitech_cert(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower() or ".pem"
    if ext not in ALLOWED_CERT_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported extension '{ext}'. Use .pem, .crt, or .cer.")

    content = await file.read()
    err = _validate_pem(content, "cert")
    if err:
        raise HTTPException(status_code=400, detail=err)

    dest = CERTS_DIR / "logitech_sync_client.crt"
    dest.write_bytes(content)

    _write_env_keys({"LOGITECH_SYNC_CERT_PATH": str(dest)})
    return {"certPath": str(dest), "message": "Certificate uploaded and saved."}


@router.post("/logitech_sync/upload-key")
async def upload_logitech_key(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower() or ".pem"
    if ext not in ALLOWED_KEY_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported extension '{ext}'. Use .pem or .key.")

    content = await file.read()
    err = _validate_pem(content, "key")
    if err:
        raise HTTPException(status_code=400, detail=err)

    dest = CERTS_DIR / "logitech_sync_client.key"
    dest.write_bytes(content)
    dest.chmod(0o600)  # restrict read to owner only

    _write_env_keys({"LOGITECH_SYNC_KEY_PATH": str(dest)})
    return {"keyPath": str(dest), "message": "Private key uploaded and saved."}


# ── Test helpers ──────────────────────────────────────────────────────────────

async def _test_microsoft365(raw: dict) -> dict:
    tenant  = raw.get("AZURE_TENANT_ID", "")
    cid     = raw.get("AZURE_CLIENT_ID", "")
    secret  = raw.get("AZURE_CLIENT_SECRET", "")
    if not all([tenant, cid, secret]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            data={
                "client_id": cid, "client_secret": secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
        )
    if r.status_code != 200:
        return {"success": False, "message": f"Token request failed: {r.json().get('error_description', r.text)[:200]}"}

    token = r.json()["access_token"]
    async with httpx.AsyncClient(timeout=10) as c:
        r2 = await c.get(
            "https://graph.microsoft.com/v1.0/organization",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r2.status_code != 200:
        return {"success": False, "message": f"Graph API error: {r2.status_code}"}

    org = r2.json().get("value", [{}])[0]
    return {"success": True, "message": f"Connected — {org.get('displayName', 'tenant verified')}"}


async def _test_freshservice(raw: dict) -> dict:
    domain  = raw.get("FRESHSERVICE_DOMAIN", "").strip().rstrip("/")
    api_key = raw.get("FRESHSERVICE_API_KEY", "")
    if not all([domain, api_key]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    token = base64.b64encode(f"{api_key}:X".encode()).decode()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"https://{domain}/api/v2/agents",
            headers={"Authorization": f"Basic {token}"},
            params={"per_page": 1},
        )
    if r.status_code == 401:
        return {"success": False, "message": "Invalid API key."}
    if r.status_code >= 400:
        return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}

    count = len(r.json().get("agents", []))
    return {"success": True, "message": f"Connected to {domain}"}


async def _test_immybot(raw: dict) -> dict:
    base_url  = raw.get("IMMYBOT_BASE_URL", "").rstrip("/")
    client_id = raw.get("IMMYBOT_CLIENT_ID", "")
    secret    = raw.get("IMMYBOT_CLIENT_SECRET", "")
    tenant_id = raw.get("IMMYBOT_TENANT_ID", "")
    app_id    = raw.get("IMMYBOT_APP_ID", "")
    if not all([base_url, client_id, secret, tenant_id, app_id]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": client_id, "client_secret": secret,
                "scope": f"{app_id}/.default", "grant_type": "client_credentials",
            },
        )
    if r.status_code != 200:
        return {"success": False, "message": f"Token request failed: {r.json().get('error_description', r.text)[:200]}"}

    token = r.json()["access_token"]
    async with httpx.AsyncClient(timeout=15) as c:
        r2 = await c.get(
            f"{base_url}/api/v1/computers/paged",
            headers={"Authorization": f"Bearer {token}"},
            params={"take": 1, "includeOffline": "true"},
        )
    if r2.status_code >= 400:
        return {"success": False, "message": f"ImmyBot API error {r2.status_code}"}

    total = r2.json().get("totalCount", "?")
    return {"success": True, "message": f"Connected — {total} computers found"}


def _build_cylance_auth_token(tenant_id: str, app_id: str, app_secret: str) -> str:
    """Build a signed JWT auth token per the Cylance auth spec."""
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


async def _test_arcticwolf(raw: dict) -> dict:
    tenant_id  = raw.get("CYLANCE_TENANT_ID", "").strip()
    app_id     = raw.get("CYLANCE_APP_ID", "").strip()
    app_secret = raw.get("CYLANCE_APP_SECRET", "").strip()
    if not all([tenant_id, app_id, app_secret]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    auth_token = _build_cylance_auth_token(tenant_id, app_id, app_secret)

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            "https://protectapi.cylance.com/auth/v2/token",
            headers={"Content-Type": "application/json; charset=utf-8"},
            json={"auth_token": auth_token},
        )
    if r.status_code == 401:
        return {"success": False, "message": "Authentication failed — check Tenant ID, Application ID, and Secret."}
    if r.status_code >= 400:
        return {"success": False, "message": f"Auth error {r.status_code}: {r.text[:200]}"}

    access_token = r.json().get("access_token", "")
    if not access_token:
        return {"success": False, "message": "Auth response did not contain access_token."}

    return {"success": True, "message": "Connected to Arctic Wolf Aurora (Cylance) successfully."}


async def _test_logitech_sync(raw: dict) -> dict:
    import os as _os
    cert_path = raw.get("LOGITECH_SYNC_CERT_PATH", "").strip()
    key_path  = raw.get("LOGITECH_SYNC_KEY_PATH", "").strip()
    org_id    = raw.get("LOGITECH_SYNC_ORG_ID", "").strip()
    if not all([cert_path, key_path, org_id]):
        return {"success": False, "message": "Missing credentials — save all fields first."}
    if not _os.path.isfile(cert_path):
        return {"success": False, "message": f"Certificate file not found: {cert_path}"}
    if not _os.path.isfile(key_path):
        return {"success": False, "message": f"Private key file not found: {key_path}"}

    try:
        async with httpx.AsyncClient(cert=(cert_path, key_path), timeout=15) as c:
            r = await c.get(
                f"https://api.sync.logitech.com/v1/org/{org_id}/place",
                params={"rooms": "true", "projection": "place.info"},
            )
            if r.status_code == 401:
                return {"success": False, "message": "Certificate rejected — verify the cert and key are correct."}
            if r.status_code < 400:
                count = len((r.json().get("places") or []))
                return {"success": True, "message": f"Connected to Logitech Sync — {count} room(s) found."}
            return {"success": False, "message": f"API returned {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"success": False, "message": f"mTLS connection failed: {str(e)}"}


async def _test_intune(raw: dict) -> dict:
    tenant_id     = raw.get("INTUNE_TENANT_ID", "").strip()
    client_id     = raw.get("INTUNE_CLIENT_ID", "").strip()
    client_secret = raw.get("INTUNE_CLIENT_SECRET", "").strip()
    if not all([tenant_id, client_id, client_secret]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "client_id":     client_id,
                "client_secret": client_secret,
                "scope":         "https://graph.microsoft.com/.default",
                "grant_type":    "client_credentials",
            },
        )
    if r.status_code != 200:
        return {"success": False, "message": f"Token request failed: {r.json().get('error_description', r.text)[:200]}"}

    token = r.json()["access_token"]
    async with httpx.AsyncClient(timeout=15) as c:
        r2 = await c.get(
            "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices",
            headers={"Authorization": f"Bearer {token}"},
            params={"$top": 1, "$select": "id,deviceName"},
        )
    if r2.status_code == 403:
        return {"success": False, "message": "Token acquired but missing DeviceManagementManagedDevices.Read.All permission."}
    if r2.status_code >= 400:
        return {"success": False, "message": f"Intune API error {r2.status_code}: {r2.text[:200]}"}

    return {"success": True, "message": "Connected to Microsoft Intune successfully."}


async def _test_ringcentral(raw: dict) -> dict:
    client_id     = raw.get("RC_CLIENT_ID", "").strip()
    client_secret = raw.get("RC_CLIENT_SECRET", "").strip()
    jwt_token     = raw.get("RC_JWT", "").strip()
    server_url    = raw.get("RC_SERVER_URL", "https://platform.ringcentral.com").strip().rstrip("/")

    if not all([client_id, client_secret, jwt_token]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{server_url}/restapi/oauth/token",
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content=(
                "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer"
                f"&assertion={jwt_token}"
            ),
        )

    if r.status_code != 200:
        err = r.json().get("error_description", r.text[:200])
        return {"success": False, "message": f"Auth failed: {err}"}

    token = r.json().get("access_token", "")
    if not token:
        return {"success": False, "message": "Token response did not contain access_token."}

    # Verify by fetching account info
    async with httpx.AsyncClient(timeout=10) as c:
        r2 = await c.get(
            f"{server_url}/restapi/v1.0/account/~",
            headers={"Authorization": f"Bearer {token}"},
        )

    if r2.status_code != 200:
        return {"success": False, "message": f"Token valid but account lookup failed ({r2.status_code})."}

    acct = r2.json()
    name = acct.get("name", "") or acct.get("mainNumber", "account verified")
    return {"success": True, "message": f"Connected — {name}"}
