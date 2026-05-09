import os
import re
import json
import uuid
import base64
import httpx
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Request
from pydantic import BaseModel
from dotenv import load_dotenv
from jose import jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import UserRecord, ClientIntegration, TicketCustomer
from .settings import require_admin

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

ENV_PATH  = Path(__file__).parent.parent / ".env"
CERTS_DIR = Path(__file__).parent.parent / "certs"
CERTS_DIR.mkdir(parents=True, exist_ok=True)

LOGOS_DIR = Path(__file__).parent.parent / "uploads" / "integration-logos"
LOGOS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}


def _get_logo_url(integration_id: str) -> str | None:
    key = f"{integration_id.upper()}_LOGO_PATH"
    path_str = os.environ.get(key, "") or _read_env_raw().get(key, "")
    path_str = path_str.strip()
    if not path_str:
        return None
    p = Path(path_str)
    if not p.is_file():
        return None
    try:
        rel = p.relative_to(Path(__file__).parent.parent / "uploads")
        mtime = int(p.stat().st_mtime)
        return f"/uploads/{rel.as_posix()}?t={mtime}"
    except ValueError:
        return None

# ── Integration definitions ───────────────────────────────────────────────────

INTEGRATIONS = {
    "microsoft365": {
        "id":          "microsoft365",
        "name":        "Microsoft 365",
        "description": "Azure AD & Graph API — powers User Lookup, Shared Mailboxes, and authentication.",
        "icon":        "☁️",
        "category":    "Directory Sync",
        "categories":  ["Directory Sync", "Single Sign-On (SSO)", "Calendars"],
        "docs_url":    "https://portal.azure.com",
        "fields": [
            {"key": "AZURE_TENANT_ID",     "label": "Tenant ID",     "secret": False},
            {"key": "AZURE_CLIENT_ID",     "label": "Client ID",     "secret": False},
            {"key": "AZURE_CLIENT_SECRET", "label": "Client Secret", "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Register an application in Azure AD",
                "body":  "Go to portal.azure.com → Azure Active Directory → App registrations → New registration. Give it a name (e.g. \"ControlPoint\") and click Register.",
            },
            {
                "title": "Copy your Tenant ID and Client ID",
                "body":  "On the app's Overview page, copy the Directory (tenant) ID and Application (client) ID into the fields on the right.",
            },
            {
                "title": "Grant API permissions",
                "body":  "Go to API permissions → Add a permission → Microsoft Graph → Application permissions. Add: User.Read.All, Group.Read.All, Mail.ReadBasic.All, Calendars.Read. Then click Grant admin consent for your tenant.",
            },
            {
                "title": "Create a client secret",
                "body":  "Go to Certificates & secrets → New client secret. Set an expiry and click Add. Copy the Value immediately — it will not be shown again.",
            },
        ],
    },
    "workday": {
        "id":          "workday",
        "name":        "Workday",
        "description": "Workday HCM — syncs employee directory, org structure, and worker profiles.",
        "icon":        "📋",
        "category":    "Directory Sync",
        "docs_url":    "https://developer.workday.com",
        "fields": [
            {"key": "WORKDAY_TENANT",        "label": "Tenant Name",    "secret": False, "placeholder": "mycompany"},
            {"key": "WORKDAY_CLIENT_ID",     "label": "Client ID",      "secret": False},
            {"key": "WORKDAY_CLIENT_SECRET", "label": "Client Secret",  "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Find your tenant name",
                "body":  "Your tenant name is the subdomain in your Workday URL. For example, if your URL is https://wd2.myworkday.com/mycompany, your tenant name is \"mycompany\".",
            },
            {
                "title": "Create an Integration System User (ISU)",
                "body":  "In Workday, search for \"Create Integration System User\". Set a username, assign a password, and check \"Do Not Allow UI Sessions\" to restrict the account to API use only.",
            },
            {
                "title": "Assign security permissions",
                "body":  "Search for \"Create Security Group\" and create an Integration System Security Group. Add the ISU to the group, then assign domain security policies that allow access to worker and org data (e.g. Worker Data, Organization Data).",
            },
            {
                "title": "Register an API Client",
                "body":  "Search for \"Register API Client for Integrations\". Give it a name, set the grant type to Client Credentials, and assign your security group. Copy the Client ID and Client Secret shown — the secret will not be displayed again.",
            },
        ],
    },
    "freshservice": {
        "id":          "freshservice",
        "name":        "Freshservice",
        "description": "IT service management — powers ticket lookup and creation.",
        "icon":        "🎫",
        "category":    "Facility Ticketing",
        "docs_url":    "https://api.freshservice.com",
        "fields": [
            {"key": "FRESHSERVICE_DOMAIN",  "label": "Domain",  "secret": False, "placeholder": "company.freshservice.com"},
            {"key": "FRESHSERVICE_API_KEY", "label": "API Key", "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Find your Freshservice domain",
                "body":  "Your domain is the subdomain you use to log in — e.g. company.freshservice.com. Enter it without https://.",
            },
            {
                "title": "Generate an API key",
                "body":  "Log in to Freshservice as an admin. Click your avatar in the top-right → Profile Settings → scroll to \"Your API Key\" and copy it.",
            },
        ],
    },
    "immybot": {
        "id":          "immybot",
        "name":        "ImmyBot",
        "description": "Endpoint management — powers device lookup and computer management.",
        "icon":        "🤖",
        "category":    "Asset",
        "docs_url":    "https://docs.immy.bot",
        "fields": [
            {"key": "IMMYBOT_BASE_URL",     "label": "Base URL",      "secret": False, "placeholder": "https://company.immy.bot"},
            {"key": "IMMYBOT_CLIENT_ID",    "label": "Client ID",     "secret": False},
            {"key": "IMMYBOT_CLIENT_SECRET","label": "Client Secret", "secret": True},
            {"key": "IMMYBOT_TENANT_ID",    "label": "Tenant ID",     "secret": False},
            {"key": "IMMYBOT_APP_ID",       "label": "App ID",        "secret": False, "placeholder": "https://company.immy.bot"},
        ],
        "setup_guide": [
            {
                "title": "Find your Base URL",
                "body":  "Your Base URL is the full address of your ImmyBot instance, e.g. https://company.immy.bot.",
            },
            {
                "title": "Create an OAuth application in ImmyBot",
                "body":  "In ImmyBot go to Settings → OAuth → Add OAuth Application. Set the grant type to Client Credentials. Copy the Client ID and Client Secret.",
            },
            {
                "title": "Get your Azure Tenant ID",
                "body":  "In Azure Portal go to Azure Active Directory → Overview and copy the Tenant ID.",
            },
            {
                "title": "Get the ImmyBot App ID from Azure",
                "body":  "In Azure Portal go to Enterprise Applications, search for your ImmyBot instance, and copy the Application (client) ID from its Properties page.",
            },
        ],
    },
    "arcticwolf": {
        "id":          "arcticwolf",
        "name":        "Arctic Wolf Aurora (Cylance)",
        "description": "Cylance/Aurora EDR — pulls security alerts, threats, and device observations.",
        "icon":        "🐺",
        "category":    "Security",
        "docs_url":    "https://docs.arcticwolf.com/bundle/Aurora-User-API-guide/page/",
        "fields": [
            {"key": "CYLANCE_TENANT_ID",  "label": "Tenant ID",           "secret": False},
            {"key": "CYLANCE_APP_ID",     "label": "Application ID",      "secret": False},
            {"key": "CYLANCE_APP_SECRET", "label": "Application Secret",  "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Log in to the Cylance console",
                "body":  "Go to protect.cylance.com and sign in with your administrator credentials.",
            },
            {
                "title": "Create a custom API application",
                "body":  "Navigate to Settings → Integrations → Custom Applications → Add New Application. Give it a descriptive name (e.g. \"ControlPoint\") and click Save.",
            },
            {
                "title": "Copy your credentials",
                "body":  "After creation, copy the Tenant ID, Application ID, and Application Secret. The secret is shown only once — copy it immediately before leaving the page.",
            },
        ],
    },
    "ccure": {
        "id":          "ccure",
        "name":        "C•CURE 9000",
        "description": "Software House C•CURE 9000 — pulls badge holders, access levels, and door/reader inventory.",
        "icon":        "🪪",
        "category":    "Badges & Access Control Systems",
        "docs_url":    "https://www.swhouse.com/products/software_CCURE9000.aspx",
        "fields": [
            {"key": "CCURE_SERVER_URL", "label": "Server URL",  "secret": False, "placeholder": "https://ccure.company.com:8443"},
            {"key": "CCURE_USERNAME",   "label": "Username",    "secret": False},
            {"key": "CCURE_PASSWORD",   "label": "Password",    "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Find your C•CURE server URL",
                "body":  "Your server URL is the address of the C•CURE 9000 Application Server running the Victor Web Service, e.g. https://ccure.company.com:8443. Include the port if it is not the default 443.",
            },
            {
                "title": "Verify the Victor Web Service is running",
                "body":  "On the C•CURE Application Server, open Windows Services and confirm that \"Victor Web Service\" is running. This is required for all REST API access.",
            },
            {
                "title": "Create a dedicated operator account",
                "body":  "In the C•CURE 9000 Administration Workstation, create a dedicated operator account for API access. Assign it the minimum privileges needed to read cardholder, badge, and door data. Avoid using a shared admin account.",
            },
            {
                "title": "Enter your credentials",
                "body":  "Enter the server URL, operator username, and password. The API authenticates via the Victor Web Service login endpoint and returns a session token used for subsequent requests.",
            },
        ],
    },
    "logitech_sync": {
        "id":          "logitech_sync",
        "name":        "Logitech Sync",
        "description": "Logitech Sync Portal — pulls meeting room spaces and their assigned devices.",
        "icon":        "📹",
        "category":    "Video Conferencing",
        "docs_url":    "https://developer.logitech.com/en-us/sync/",
        "fields": [
            {"key": "LOGITECH_SYNC_CERT_PATH", "label": "Client Certificate", "secret": False, "type": "file", "upload_url": "/api/integrations/logitech_sync/upload-cert", "accept": ".pem,.crt,.cer"},
            {"key": "LOGITECH_SYNC_KEY_PATH",  "label": "Private Key",        "secret": False, "type": "file", "upload_url": "/api/integrations/logitech_sync/upload-key",  "accept": ".pem,.key"},
            {"key": "LOGITECH_SYNC_ORG_ID",    "label": "Org ID",             "secret": False},
        ],
        "setup_guide": [
            {
                "title": "Generate a client certificate and private key",
                "body":  "Run this OpenSSL command to create a self-signed certificate pair:\nopenssl req -x509 -newkey rsa:4096 -keyout client.key -out client.crt -days 365 -nodes -subj \"/CN=ControlPoint\"",
            },
            {
                "title": "Register your certificate in the Logitech Sync Portal",
                "body":  "Log in to sync.logitech.com → Organization Settings → API Access → upload your client.crt file.",
            },
            {
                "title": "Find your Org ID",
                "body":  "Your Org ID is visible under Organization Settings in the Logitech Sync Portal.",
            },
            {
                "title": "Upload your certificate files here",
                "body":  "Use the upload buttons in the Connection Details section to upload your client.crt (Client Certificate) and client.key (Private Key).",
            },
        ],
    },
    "intune": {
        "id":          "intune",
        "name":        "Microsoft Intune",
        "description": "Microsoft Intune MDM — pulls managed device inventory, compliance states, and OS breakdown.",
        "icon":        "💻",
        "category":    "Asset",
        "docs_url":    "https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice",
        "fields": [
            {"key": "INTUNE_TENANT_ID",     "label": "Tenant ID",     "secret": False},
            {"key": "INTUNE_CLIENT_ID",     "label": "Client ID",     "secret": False},
            {"key": "INTUNE_CLIENT_SECRET", "label": "Client Secret", "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Register an application in Azure AD",
                "body":  "Go to portal.azure.com → Azure Active Directory → App registrations → New registration. Give it a name and click Register.",
            },
            {
                "title": "Copy your Tenant ID and Client ID",
                "body":  "On the app's Overview page, copy the Directory (tenant) ID and Application (client) ID into the fields on the right.",
            },
            {
                "title": "Grant Intune API permissions",
                "body":  "Go to API permissions → Add a permission → Microsoft Graph → Application permissions. Add: DeviceManagementManagedDevices.Read.All. Click Grant admin consent.",
            },
            {
                "title": "Create a client secret",
                "body":  "Go to Certificates & secrets → New client secret. Copy the Value immediately after creation — it will not be shown again.",
            },
        ],
    },
    "papercut": {
        "id":          "papercut",
        "name":        "PaperCut",
        "description": "PaperCut print management — pulls printer inventory and status for map placement.",
        "icon":        "🖨️",
        "category":    "Asset",
        "docs_url":    "https://www.papercut.com/help/manuals/ng-mf/applicationserver/tools/rest-api/",
        "fields": [
            {"key": "PAPERCUT_SERVER_URL", "label": "Server URL", "secret": False, "placeholder": "https://papercut.company.com:9191"},
            {"key": "PAPERCUT_AUTH_TOKEN", "label": "Auth Token", "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Find your PaperCut server URL",
                "body":  "Your server URL is the address of your PaperCut Application Server including the port, e.g. https://papercut.company.com:9191. For cloud-hosted instances use port 9192.",
            },
            {
                "title": "Enable the Public REST API",
                "body":  "In the PaperCut admin console go to Options → Advanced → Enable Public API and make sure the toggle is on.",
            },
            {
                "title": "Copy your Auth Token",
                "body":  "In the PaperCut admin console go to Options → Advanced → Auth Token. Copy the token shown — this is the shared secret used to authenticate API requests.",
            },
        ],
    },
    "unifi": {
        "id":          "unifi",
        "name":        "UniFi Network",
        "description": "Ubiquiti UniFi Site Manager API — pulls all managed sites, hosts, and device data across your entire UniFi account.",
        "icon":        "📡",
        "category":    "Networking",
        "categories":  ["Networking"],
        "docs_url":    "https://developer.ui.com",
        "fields": [
            {"key": "UNIFI_API_KEY", "label": "API Key", "secret": True},
        ],
        "setup_guide": [
            {
                "title": "Sign in to UniFi Site Manager",
                "body":  "Go to unifi.ui.com and sign in with your Ubiquiti account. This account must have access to all the sites you want to manage.",
            },
            {
                "title": "Navigate to the API section",
                "body":  "Go to the API section (GA) or Settings → API Keys (EA).",
            },
            {
                "title": "Create a new API key",
                "body":  "Click \"Create New API Key\", give it a name (e.g. \"ControlPoint\"), and copy the generated key immediately — it will only be shown once.",
            },
        ],
    },
    "meraki": {
        "id":          "meraki",
        "name":        "Cisco Meraki",
        "description": "Cisco Meraki Dashboard API — inventory and monitor all Meraki network devices, clients, and organizations from a single pane.",
        "icon":        "🌐",
        "category":    "Networking",
        "categories":  ["Networking"],
        "docs_url":    "https://developer.cisco.com/meraki/api-v1/",
        "fields": [
            {"key": "MERAKI_API_KEY",      "label": "API Key",          "secret": True},
            {"key": "MERAKI_ORG_ID",       "label": "Organization ID",  "secret": False, "optional": True, "placeholder": "Leave blank to auto-detect from API key"},
            {"key": "MERAKI_BASE_URL",     "label": "Base URL",         "secret": False, "optional": True, "placeholder": "https://api.meraki.com/api/v1  (leave blank for cloud)"},
        ],
        "setup_guide": [
            {
                "title": "Enable API access in Meraki Dashboard",
                "body":  "Sign in to dashboard.meraki.com → Organization → Settings → Dashboard API access → check \"Enable access to the Cisco Meraki Dashboard API\" and save.",
            },
            {
                "title": "Generate an API key",
                "body":  "In the Dashboard, click your account avatar (top-right) → My profile → scroll to \"API access\" → Generate new API key. Copy the key immediately — it is shown only once. The key inherits the permissions of the account that created it.",
            },
            {
                "title": "Find your Organization ID (optional)",
                "body":  "If you manage multiple Meraki organizations and want to restrict ControlPoint to one, go to Organization → Settings and copy the Organization ID shown in the URL (a numeric value). Leave the field blank to auto-detect based on your API key.",
            },
            {
                "title": "On-premises Dashboard (optional)",
                "body":  "If you are running Meraki on a private cloud or using a regional API endpoint, enter the custom Base URL. Otherwise leave it blank and ControlPoint will use the Cisco cloud API at api.meraki.com.",
            },
        ],
    },
    "fortinet": {
        "id":          "fortinet",
        "name":        "Fortinet",
        "description": "Fortinet FortiManager REST API — centrally manage FortiGate firewall policies, device inventory, and security fabric from ControlPoint.",
        "icon":        "🛡️",
        "category":    "Networking",
        "categories":  ["Networking", "Security"],
        "docs_url":    "https://docs.fortinet.com/document/fortimanager/latest/json-api-reference/",
        "fields": [
            {"key": "FORTINET_HOST",       "label": "FortiManager Host", "secret": False, "placeholder": "https://fortimanager.company.com"},
            {"key": "FORTINET_API_KEY",    "label": "API Key",           "secret": True},
            {"key": "FORTINET_VERIFY_SSL", "label": "Verify SSL",        "secret": False, "optional": True, "placeholder": "true  (set false only for self-signed certs in lab environments)"},
        ],
        "setup_guide": [
            {
                "title": "Create a dedicated API admin account in FortiManager",
                "body":  "In FortiManager go to System Settings → Administrators → Create New. Set the admin type to \"REST API\" and assign a JSON API access profile (at minimum read access to Device Manager and Policy & Objects). Note the username — you will need it to generate an API key.",
            },
            {
                "title": "Generate an API key (token)",
                "body":  "After creating the REST API admin, FortiManager displays a one-time API key (bearer token). Copy it immediately — it cannot be retrieved later. If you lose it, delete the admin account and recreate it.",
            },
            {
                "title": "Enter your FortiManager host",
                "body":  "Enter the full URL of your FortiManager appliance including the protocol, e.g. https://fortimanager.company.com or https://192.168.1.100. Do not include a trailing slash.",
            },
            {
                "title": "SSL verification",
                "body":  "If your FortiManager uses a publicly trusted TLS certificate leave Verify SSL blank (defaults to true). For lab or self-signed certificate environments, set it to false. Always use a trusted cert in production.",
            },
        ],
    },
    "ringcentral": {
        "id":          "ringcentral",
        "name":        "RingCentral",
        "description": "RingCentral telephony — monitor user presence and manage DND status across teams.",
        "icon":        "📞",
        "category":    "Employee Experience",
        "docs_url":    "https://developers.ringcentral.com",
        "fields": [
            {"key": "RC_CLIENT_ID",     "label": "Client ID",     "secret": False},
            {"key": "RC_CLIENT_SECRET", "label": "Client Secret", "secret": True},
            {"key": "RC_JWT",           "label": "JWT Token",     "secret": True,  "placeholder": "Private app JWT from RingCentral Developer Console"},
        ],
        "setup_guide": [
            {
                "title": "Create an app in the RingCentral Developer Console",
                "body":  "Go to developers.ringcentral.com → My Apps → Create App. Choose the \"Server/Bot\" app type and select JWT as the authentication method. Add the ReadPresence scope (and any others your use case requires).",
            },
            {
                "title": "Copy your Client ID and Client Secret",
                "body":  "From the app's Credentials tab, copy the Client ID and Client Secret.",
            },
            {
                "title": "Generate a personal JWT token",
                "body":  "In the Developer Console, go to your account menu → Credentials → Create JWT. This token authenticates server-to-server requests — treat it as a secret and do not share it.",
            },
        ],
    },
    "okta": {
        "id":          "okta",
        "name":        "Okta",
        "description": "Okta identity platform — directory sync for user/group data and SSO via SAML 2.0.",
        "icon":        "🔐",
        "category":    "Directory Sync",
        "categories":  ["Directory Sync", "Single Sign-On (SSO)"],
        "docs_url":    "https://developer.okta.com",
        "fields": [
            {"key": "OKTA_DOMAIN",             "label": "Okta Domain",    "secret": False, "placeholder": "company.okta.com"},
            {"key": "OKTA_API_TOKEN",          "label": "API Token",      "secret": True},
            {"key": "OKTA_SAML_IDP_SSO_URL",  "label": "IdP SSO URL",    "secret": False, "optional": True, "placeholder": "https://company.okta.com/app/.../sso/saml"},
            {"key": "OKTA_SAML_IDP_ENTITY_ID","label": "IdP Entity ID",  "secret": False, "optional": True, "placeholder": "http://www.okta.com/..."},
            {"key": "OKTA_SAML_IDP_CERT",     "label": "IdP Certificate","secret": True,  "optional": True},
        ],
        "setup_guide": [
            {
                "title": "Find your Okta domain",
                "body":  "Your Okta domain is the subdomain you use to sign in, e.g. company.okta.com. Enter it without https://. If you are on the Okta Preview sandbox it ends in .oktapreview.com.",
            },
            {
                "title": "Create an API token for directory sync",
                "body":  "Sign in to your Okta Admin Console → Security → API → Tokens → Create Token. Give it a name (e.g. \"ControlPoint\") and copy the token immediately — it is shown only once. The account used must have at minimum Read-Only Admin or a custom role with Users and Groups read permission.",
            },
            {
                "title": "Create a SAML 2.0 app for SSO (optional)",
                "body":  "In the Okta Admin Console go to Applications → Create App Integration → SAML 2.0.\n\nSet these SP values:\n• Single sign-on URL (ACS): {your_portal_url}/api/auth/saml/acs\n• Audience URI (Entity ID): {your_portal_url}/api/auth/saml/metadata\n• Name ID format: EmailAddress\n• App username: Email\n\nAfter saving, open the app's Sign On tab → View SAML Setup Instructions to copy the IdP SSO URL, IdP Entity ID, and X.509 Certificate.",
            },
            {
                "title": "Assign the SAML app to users or groups",
                "body":  "On the app's Assignments tab, assign the application to the users or groups who should be able to sign in via SSO. Users not assigned will receive an access-denied error.",
            },
            {
                "title": "Set a portal JWT secret",
                "body":  "After Okta authenticates a user, ControlPoint issues its own signed session token. Add PORTAL_JWT_SECRET=<a long random string> to your .env file. Generate one with:\n  openssl rand -hex 32",
            },
        ],
    },
    "ringcentral_embeddable": {
        "id":          "ringcentral_embeddable",
        "name":        "RingCentral Phone Widget",
        "description": "Embed the RingCentral softphone directly in the portal so employees can make and receive calls without leaving the browser.",
        "icon":        "☎️",
        "category":    "Employee Experience",
        "docs_url":    "https://developers.ringcentral.com/guide/embeddable",
        "fields": [
            {"key": "RC_WIDGET_CLIENT_ID",     "label": "Widget Client ID",     "secret": False},
            {"key": "RC_WIDGET_CLIENT_SECRET", "label": "Widget Client Secret", "secret": True},
            {"key": "RC_WIDGET_SERVER_URL",    "label": "Server URL",           "secret": False, "optional": True, "placeholder": "https://platform.ringcentral.com  (or https://platform.devtest.ringcentral.com for Sandbox)"},
        ],
        "setup_guide": [
            {
                "title": "Create a Browser-based app in the RingCentral Developer Console",
                "body":  "Go to developers.ringcentral.com → My Apps → Create App. Choose the \"Browser-based app\" (or \"Web\" / \"Authorization Code + PKCE\") app type. This is separate from the JWT app used for presence monitoring.",
            },
            {
                "title": "Add your redirect URI",
                "body":  "Under Auth → Redirect URIs, add:\nhttps://controlpoint.claimassistsolutions.com/rc-oauth.html\nhttp://localhost:5173/rc-oauth.html (for local dev)\n\nThis page handles the OAuth callback and passes the auth code back to the widget.",
            },
            {
                "title": "Set required scopes",
                "body":  "Add these OAuth scopes: VoIP Calling, ReadAccounts, ReadCallLog, ReadPresence, Contacts. Click Save.",
            },
            {
                "title": "Copy your Widget Client ID and Secret",
                "body":  "From the app's Credentials tab, copy the Client ID and Client Secret and enter them here. Once saved, the softphone widget will appear for all users who have RC Widget access enabled in Settings → Users.",
            },
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

def _is_enabled(integration_id: str) -> bool:
    key = f"{integration_id.upper()}_ENABLED"
    val = _read_env_raw().get(key, "true").strip().lower()
    return val != "false"


class IntegrationUpdate(BaseModel):
    values: dict[str, str]

class IntegrationEnabled(BaseModel):
    enabled: bool


# ── Routes ────────────────────────────────────────────────────────────────────

def _resolve_portal_url() -> str:
    origins = os.getenv("ALLOWED_ORIGINS", "")
    for o in origins.split(","):
        o = o.strip()
        if o.startswith("https://"):
            return o.rstrip("/")
    return "https://your-portal-domain.com"


def _inject_portal_url(guide: list[dict]) -> list[dict]:
    url = _resolve_portal_url()
    return [
        {**step, "body": step["body"].replace("{portal_url}", url)}
        for step in guide
    ]


# ── Client Integration CRUD ───────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ci_out(ci: ClientIntegration, customer_name: str | None = None) -> dict:
    intg_def = INTEGRATIONS.get(ci.integration_type, {})
    fields   = intg_def.get("fields", [])
    raw_vals: dict = json.loads(ci.values_json or "{}")
    fields_out = []
    for f in fields:
        v = raw_vals.get(f["key"], "")
        fields_out.append({**f, "value": MASK if (f.get("secret") and v) else v})
    return {
        "id":               ci.id,
        "customer_id":      ci.customer_id,
        "customer_name":    customer_name,
        "integration_type": ci.integration_type,
        "name":             intg_def.get("name", ci.integration_type),
        "icon":             intg_def.get("icon", "🔌"),
        "label":            ci.label,
        "enabled":          ci.enabled,
        "configured":       all(raw_vals.get(f["key"], "").strip() for f in fields if not f.get("optional")),
        "fields":           fields_out,
        "created_at":       ci.created_at,
    }


class ClientIntegrationIn(BaseModel):
    customer_id:      int
    integration_type: str
    label:            str | None = None
    values:           dict[str, str] = {}


class ClientIntegrationUpdate(BaseModel):
    label:   str | None = None
    values:  dict[str, str] = {}
    enabled: bool | None = None


@router.get("/clients/")
async def list_client_integrations(customer_id: int | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(ClientIntegration)
    if customer_id:
        stmt = stmt.where(ClientIntegration.customer_id == customer_id)
    rows = (await db.execute(stmt)).scalars().all()
    cust_ids = list({r.customer_id for r in rows})
    cust_map: dict[int, str] = {}
    if cust_ids:
        custs = (await db.execute(select(TicketCustomer).where(TicketCustomer.id.in_(cust_ids)))).scalars().all()
        cust_map = {c.id: c.name for c in custs}
    return [_ci_out(r, cust_map.get(r.customer_id)) for r in rows]


@router.post("/clients/", status_code=201)
async def create_client_integration(body: ClientIntegrationIn, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if body.integration_type not in INTEGRATIONS:
        raise HTTPException(400, "Unknown integration type")
    existing = (await db.execute(
        select(ClientIntegration).where(
            ClientIntegration.customer_id == body.customer_id,
            ClientIntegration.integration_type == body.integration_type,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "This client already has that integration configured")
    intg_def = INTEGRATIONS[body.integration_type]
    vals: dict[str, str] = {}
    for f in intg_def["fields"]:
        v = body.values.get(f["key"], "").strip()
        if v:
            vals[f["key"]] = v
    now = _now_iso()
    ci = ClientIntegration(
        customer_id=body.customer_id,
        integration_type=body.integration_type,
        label=body.label,
        values_json=json.dumps(vals),
        enabled=True,
        created_at=now,
        updated_at=now,
    )
    db.add(ci)
    await db.commit()
    await db.refresh(ci)
    cust = (await db.execute(select(TicketCustomer).where(TicketCustomer.id == ci.customer_id))).scalar_one_or_none()
    return _ci_out(ci, cust.name if cust else None)


@router.put("/clients/{ci_id}")
async def update_client_integration(ci_id: int, body: ClientIntegrationUpdate, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    ci = (await db.execute(select(ClientIntegration).where(ClientIntegration.id == ci_id))).scalar_one_or_none()
    if not ci:
        raise HTTPException(404, "Not found")
    intg_def = INTEGRATIONS.get(ci.integration_type, {})
    if body.label is not None:
        ci.label = body.label
    if body.enabled is not None:
        ci.enabled = body.enabled
    if body.values:
        old_vals: dict = json.loads(ci.values_json or "{}")
        for f in intg_def.get("fields", []):
            k = f["key"]
            v = body.values.get(k, "").strip()
            if f.get("secret") and (not v or v == MASK):
                continue
            if v:
                old_vals[k] = v
        ci.values_json = json.dumps(old_vals)
    ci.updated_at = _now_iso()
    await db.commit()
    cust = (await db.execute(select(TicketCustomer).where(TicketCustomer.id == ci.customer_id))).scalar_one_or_none()
    return _ci_out(ci, cust.name if cust else None)


@router.delete("/clients/{ci_id}", status_code=204)
async def delete_client_integration(ci_id: int, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    ci = (await db.execute(select(ClientIntegration).where(ClientIntegration.id == ci_id))).scalar_one_or_none()
    if not ci:
        raise HTTPException(404, "Not found")
    await db.delete(ci)
    await db.commit()


@router.post("/clients/{ci_id}/toggle")
async def toggle_client_integration(ci_id: int, body: IntegrationEnabled, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    ci = (await db.execute(select(ClientIntegration).where(ClientIntegration.id == ci_id))).scalar_one_or_none()
    if not ci:
        raise HTTPException(404, "Not found")
    ci.enabled = body.enabled
    ci.updated_at = _now_iso()
    await db.commit()
    return {"id": ci_id, "enabled": ci.enabled}


@router.post("/clients/{ci_id}/test")
async def test_client_integration(ci_id: int, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    ci = (await db.execute(select(ClientIntegration).where(ClientIntegration.id == ci_id))).scalar_one_or_none()
    if not ci:
        raise HTTPException(404, "Not found")
    raw: dict = json.loads(ci.values_json or "{}")
    try:
        if ci.integration_type == "freshservice":   return await _test_freshservice(raw)
        if ci.integration_type == "microsoft365":   return await _test_microsoft365(raw)
        if ci.integration_type == "immybot":        return await _test_immybot(raw)
        if ci.integration_type == "intune":         return await _test_intune(raw)
        if ci.integration_type == "arcticwolf":     return await _test_arcticwolf(raw)
        if ci.integration_type == "ringcentral":    return await _test_ringcentral(raw)
        if ci.integration_type == "unifi":          return await _test_unifi(raw)
        if ci.integration_type == "okta":           return await _test_okta(raw)
        if ci.integration_type == "meraki":         return await _test_meraki(raw)
        if ci.integration_type == "fortinet":       return await _test_fortinet(raw)
        if ci.integration_type == "ccure":          return await _test_ccure(raw)
        if ci.integration_type == "papercut":       return await _test_papercut(raw)
    except Exception as e:
        return {"success": False, "message": str(e)}
    return {"success": False, "message": "Test not available for this integration type"}


# ── Global integration list / update ─────────────────────────────────────────

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
            "logo_url":    _get_logo_url(intg["id"]),
            "category":    intg.get("category", ""),
            "categories":  intg.get("categories", [intg.get("category", "")]),
            "docs_url":    intg["docs_url"],
            "setup_guide": _inject_portal_url(intg.get("setup_guide", [])),
            "configured":  all(raw.get(f["key"], "").strip() for f in intg["fields"] if not f.get("optional")),
            "enabled":     _is_enabled(intg["id"]),
            "fields":      fields_out,
        })
    return result


@router.put("/{integration_id}")
async def update_integration(integration_id: str, body: IntegrationUpdate, _: UserRecord = Depends(require_admin)):
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


@router.put("/{integration_id}/enabled")
async def set_integration_enabled(
    integration_id: str,
    body: IntegrationEnabled,
    _: UserRecord = Depends(require_admin),
):
    if integration_id not in INTEGRATIONS:
        raise HTTPException(status_code=404, detail="Integration not found")
    key = f"{integration_id.upper()}_ENABLED"
    _write_env_keys({key: "true" if body.enabled else "false"})
    return {"id": integration_id, "enabled": body.enabled}


@router.post("/{integration_id}/upload-logo")
async def upload_integration_logo(
    integration_id: str,
    file: UploadFile = File(...),
    _: UserRecord = Depends(require_admin),
):
    if integration_id not in INTEGRATIONS:
        raise HTTPException(status_code=404, detail="Integration not found")

    ext = Path(file.filename or "").suffix.lower() or ".png"
    if ext not in ALLOWED_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Use PNG, JPG, WEBP, SVG, or GIF.",
        )

    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB.")

    # Remove any previous logo for this integration
    for old in LOGOS_DIR.glob(f"{integration_id}.*"):
        old.unlink(missing_ok=True)

    dest = LOGOS_DIR / f"{integration_id}{ext}"
    dest.write_bytes(content)

    env_key = f"{integration_id.upper()}_LOGO_PATH"
    _write_env_keys({env_key: str(dest)})

    mtime = int(dest.stat().st_mtime)
    return {"logo_url": f"/uploads/integration-logos/{integration_id}{ext}?t={mtime}"}


@router.post("/{integration_id}/test")
async def test_integration(integration_id: str, _: UserRecord = Depends(require_admin)):
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
        if integration_id == "ccure":
            return await _test_ccure(raw)
        if integration_id == "workday":
            return await _test_workday(raw)
        if integration_id == "papercut":
            return await _test_papercut(raw)
        if integration_id == "ringcentral":
            return await _test_ringcentral(raw)
        if integration_id == "ringcentral_embeddable":
            return await _test_ringcentral_embeddable(raw)
        if integration_id == "unifi":
            return await _test_unifi(raw)
        if integration_id == "okta":
            return await _test_okta(raw)
        if integration_id == "meraki":
            return await _test_meraki(raw)
        if integration_id == "fortinet":
            return await _test_fortinet(raw)
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


async def _test_ccure(raw: dict) -> dict:
    server_url = raw.get("CCURE_SERVER_URL", "").strip().rstrip("/")
    username   = raw.get("CCURE_USERNAME",   "").strip()
    password   = raw.get("CCURE_PASSWORD",   "").strip()
    if not all([server_url, username, password]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as c:
            r = await c.post(
                f"{server_url}/victorwebservice/api/Authenticate/GetToken",
                json={"UserName": username, "Password": password, "ClientName": "ControlPoint"},
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid username or password."}
        if r.status_code == 404:
            return {"success": False, "message": "Victor Web Service not found — verify the server URL and that the service is running."}
        if r.status_code >= 400:
            return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}
        return {"success": True, "message": "Connected to C•CURE 9000 successfully."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


async def _test_workday(raw: dict) -> dict:
    tenant        = raw.get("WORKDAY_TENANT",        "").strip()
    client_id     = raw.get("WORKDAY_CLIENT_ID",     "").strip()
    client_secret = raw.get("WORKDAY_CLIENT_SECRET", "").strip()
    if not all([tenant, client_id, client_secret]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"https://wd2.myworkday.com/{tenant}/oauth2/v1/token",
                data={
                    "grant_type":    "client_credentials",
                    "client_id":     client_id,
                    "client_secret": client_secret,
                },
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid credentials — check Client ID, Secret, and Tenant Name."}
        if r.status_code == 404:
            return {"success": False, "message": f"Tenant '{tenant}' not found — verify your tenant name."}
        if r.status_code >= 400:
            return {"success": False, "message": f"Auth error {r.status_code}: {r.text[:200]}"}
        return {"success": True, "message": f"Connected to Workday tenant '{tenant}' successfully."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


async def _test_papercut(raw: dict) -> dict:
    server_url = raw.get("PAPERCUT_SERVER_URL", "").strip().rstrip("/")
    auth_token = raw.get("PAPERCUT_AUTH_TOKEN", "").strip()
    if not all([server_url, auth_token]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    try:
        # PaperCut internal servers commonly use self-signed certs
        async with httpx.AsyncClient(timeout=15, verify=False) as c:
            r = await c.get(
                f"{server_url}/api/health",
                headers={"Authorization": auth_token},
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid auth token."}
        if r.status_code == 404:
            # Older PaperCut versions may not have /api/health — try printers endpoint
            async with httpx.AsyncClient(timeout=15, verify=False) as c:
                r = await c.get(
                    f"{server_url}/api/printers?limit=1",
                    headers={"Authorization": auth_token},
                )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid auth token."}
        if r.status_code >= 400:
            return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}
        return {"success": True, "message": "Connected to PaperCut successfully."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


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


async def _test_ringcentral_embeddable(raw: dict) -> dict:
    client_id     = raw.get("RC_WIDGET_CLIENT_ID", "").strip()
    client_secret = raw.get("RC_WIDGET_CLIENT_SECRET", "").strip()
    if not all([client_id, client_secret]):
        return {"success": False, "message": "Missing credentials — save all fields first."}

    server_url = (
        raw.get("RC_WIDGET_SERVER_URL", "").strip()
        or "https://platform.ringcentral.com"
    ).rstrip("/")
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                f"{server_url}/restapi/v1.0/client-info",
                headers={"Authorization": f"Basic {credentials}"},
            )
        if r.status_code == 200:
            return {"success": True, "message": "Widget app credentials verified successfully."}
        if r.status_code == 401:
            return {"success": False, "message": "Invalid Widget Client ID or Secret."}
        return {"success": True, "message": "Widget app configured — credentials accepted by RingCentral."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


async def _test_okta(raw: dict) -> dict:
    domain    = raw.get("OKTA_DOMAIN", "").strip().rstrip("/").removeprefix("https://").removeprefix("http://")
    api_token = raw.get("OKTA_API_TOKEN", "").strip()
    if not all([domain, api_token]):
        return {"success": False, "message": "Missing credentials — save Okta Domain and API Token first."}

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                f"https://{domain}/api/v1/users",
                headers={"Authorization": f"SSWS {api_token}", "Accept": "application/json"},
                params={"limit": 1},
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid API token — check that the token is active and has read permissions."}
        if r.status_code == 403:
            return {"success": False, "message": "Token lacks permission to read users — assign at least Read-Only Admin or a Users read role."}
        if r.status_code == 404:
            return {"success": False, "message": f"Domain '{domain}' not found — verify your Okta domain."}
        if r.status_code >= 400:
            return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}

        users = r.json()
        count = len(users) if isinstance(users, list) else "?"
        return {"success": True, "message": f"Connected to {domain} — directory accessible."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


async def _test_unifi(raw: dict) -> dict:
    api_key = raw.get("UNIFI_API_KEY", "").strip()
    if not api_key:
        return {"success": False, "message": "Missing API key — save the field first."}

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                "https://api.ui.com/v1/hosts",
                headers={"X-API-KEY": api_key, "Accept": "application/json"},
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid API key."}
        if r.status_code == 429:
            return {"success": False, "message": "Rate limit exceeded — try again in a moment."}
        if r.status_code >= 400:
            return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}

        hosts = r.json().get("data", [])
        return {"success": True, "message": f"Connected — {len(hosts)} host(s) found across your account."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


async def _test_meraki(raw: dict) -> dict:
    api_key = raw.get("MERAKI_API_KEY", "").strip()
    if not api_key:
        return {"success": False, "message": "Missing API key — save the field first."}

    base_url = (raw.get("MERAKI_BASE_URL", "") or "https://api.meraki.com/api/v1").strip().rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                f"{base_url}/organizations",
                headers={"X-Cisco-Meraki-API-Key": api_key, "Accept": "application/json"},
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid API key."}
        if r.status_code == 429:
            return {"success": False, "message": "Rate limit exceeded — try again in a moment."}
        if r.status_code >= 400:
            return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}

        orgs = r.json()
        count = len(orgs) if isinstance(orgs, list) else 0
        return {"success": True, "message": f"Connected — {count} organization(s) accessible with this API key."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


async def _test_fortinet(raw: dict) -> dict:
    host = raw.get("FORTINET_HOST", "").strip().rstrip("/")
    api_key = raw.get("FORTINET_API_KEY", "").strip()
    if not host or not api_key:
        return {"success": False, "message": "Missing FortiManager host or API key — save all fields first."}

    verify_ssl_raw = raw.get("FORTINET_VERIFY_SSL", "true").strip().lower()
    verify_ssl = verify_ssl_raw not in ("false", "0", "no")

    try:
        async with httpx.AsyncClient(timeout=15, verify=verify_ssl) as c:
            r = await c.get(
                f"{host}/jsonrpc",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                content='{"id":1,"method":"get","params":[{"url":"/sys/status"}],"jsonrpc":"2.0"}',
            )
        if r.status_code == 401:
            return {"success": False, "message": "Invalid API key."}
        if r.status_code >= 400:
            return {"success": False, "message": f"API error {r.status_code}: {r.text[:200]}"}

        data = r.json()
        result = data.get("result", [{}])
        status_data = result[0].get("data", {}) if isinstance(result, list) else {}
        version = status_data.get("Version", "unknown version")
        return {"success": True, "message": f"Connected to FortiManager — {version}."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}
