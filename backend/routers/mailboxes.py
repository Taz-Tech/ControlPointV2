import asyncio
import json
import os
import re
import subprocess

from fastapi import APIRouter, HTTPException, Query
import httpx
from ..auth import get_graph_token, is_azure_configured

router = APIRouter(prefix="/api/mailboxes", tags=["mailboxes"])

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

MAILBOX_SELECT = (
    "displayName,mail,userPrincipalName,id,accountEnabled,"
    "assignedLicenses,jobTitle,department,officeLocation"
)

MEMBER_SELECT = "displayName,mail,userPrincipalName,id,jobTitle,department,accountEnabled"


async def _graph_get(path: str, params: dict = None, headers_extra: dict = None) -> dict:
    token = get_graph_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if headers_extra:
        headers.update(headers_extra)
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{GRAPH_BASE}{path}", headers=headers, params=params)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get("/search")
async def search_mailboxes(q: str = Query(..., min_length=1)):
    if not is_azure_configured():
        raise HTTPException(
            status_code=503,
            detail="Azure credentials not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in .env",
        )

    # Use $search for partial/contains matching — Graph supports this with
    # ConsistencyLevel: eventual. $filter with contains() is not supported.
    q_safe = q.replace('"', '')  # strip quotes to avoid breaking search syntax

    data = await _graph_get(
        "/users",
        params={
            "$search": f'"displayName:{q_safe}" OR "mail:{q_safe}" OR "userPrincipalName:{q_safe}"',
            "$select": MAILBOX_SELECT,
            "$count": "true",
            "$top": "50",
            "$orderby": "displayName",
        },
        headers_extra={"ConsistencyLevel": "eventual"},
    )

    all_users = data.get("value", [])

    # Prefer accounts with no license or disabled — classic shared mailbox pattern.
    # Fall back to all matching mail accounts if that yields nothing.
    mailboxes = [
        m for m in all_users
        if m.get("mail") and (
            not m.get("assignedLicenses") or not m.get("accountEnabled")
        )
    ]
    if not mailboxes:
        mailboxes = [m for m in all_users if m.get("mail")]

    return {"mailboxes": mailboxes, "total": len(mailboxes)}


@router.get("/{mailbox_id}/members")
async def get_mailbox_members(mailbox_id: str):
    if not is_azure_configured():
        raise HTTPException(status_code=503, detail="Azure credentials not configured.")

    # 1. Get the mailbox's email address
    user = await _graph_get(f"/users/{mailbox_id}", params={"$select": "mail,displayName"})
    mail = user.get("mail")
    if not mail:
        return {"members": [], "source": "no_mail", "group_name": None}

    # 2. Find the M365 group associated with this shared mailbox
    group_data = await _graph_get(
        "/groups",
        params={
            "$filter": f"mail eq '{mail}'",
            "$select": "id,displayName,mail",
            "$top": "1",
        },
    )
    groups = group_data.get("value", [])

    if not groups:
        # Traditional Exchange shared mailbox — try owners/members via users endpoint
        return {
            "members": [],
            "source": "no_group",
            "group_name": None,
        }

    group = groups[0]
    group_id = group["id"]

    # 3. Fetch group members
    members_data = await _graph_get(
        f"/groups/{group_id}/members",
        params={"$select": MEMBER_SELECT, "$top": "100"},
    )

    members = [
        {
            "id": m.get("id"),
            "displayName": m.get("displayName"),
            "mail": m.get("mail") or m.get("userPrincipalName"),
            "jobTitle": m.get("jobTitle"),
            "department": m.get("department"),
            "accountEnabled": m.get("accountEnabled"),
        }
        for m in members_data.get("value", [])
        if m.get("@odata.type") == "#microsoft.graph.user"
    ]

    return {
        "members": members,
        "source": "group",
        "group_name": group.get("displayName"),
    }


_EXO_PS_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
try {
    $certPassword = ConvertTo-SecureString -String $env:EXCHANGE_CERT_PASSWORD -AsPlainText -Force
    Connect-ExchangeOnline `
        -AppId $env:AZURE_CLIENT_ID `
        -CertificateFilePath $env:EXCHANGE_CERT_PATH `
        -CertificatePassword $certPassword `
        -Organization $env:EXO_ORG `
        -ShowBanner:$false `
        -WarningAction SilentlyContinue | Out-Null

    $identity = $env:MAILBOX_IDENTITY

    # Full Access
    $fullAccess = @(
        Get-EXOMailboxPermission -Identity $identity |
        Where-Object { $_.User -notlike "NT AUTHORITY\SELF" -and $_.IsInherited -eq $false } |
        ForEach-Object {
            @{
                user         = $_.User.ToString()
                accessRights = @($_.AccessRights | ForEach-Object { $_.ToString() })
                deny         = [bool]$_.Deny
            }
        }
    )

    # Send As
    $sendAs = @(
        Get-RecipientPermission -Identity $identity |
        Where-Object { $_.Trustee -notlike "NT AUTHORITY\SELF" -and $_.IsInherited -eq $false } |
        ForEach-Object {
            @{
                trustee      = $_.Trustee.ToString()
                accessRights = @($_.AccessRights | ForEach-Object { $_.ToString() })
            }
        }
    )

    # Send on Behalf
    $sobRaw = (Get-Mailbox $identity).GrantSendOnBehalfTo
    $sendOnBehalf = if ($sobRaw) {
        @($sobRaw | ForEach-Object {
            $s = $_.ToString()
            if ($s -match '^CN=([^,]+)') { $Matches[1] } else { $s }
        })
    } else { @() }

    Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null

    @{
        fullAccess   = $fullAccess
        sendAs       = $sendAs
        sendOnBehalf = $sendOnBehalf
    } | ConvertTo-Json -Depth 10 -Compress
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
"""


async def _run_exo_permissions(mailbox_email: str) -> dict:
    import tempfile

    org       = os.getenv("EXCHANGE_ORGANIZATION",  "").strip()
    cert_path = os.getenv("EXCHANGE_CERT_PATH",     "").strip()
    cert_pass = os.getenv("EXCHANGE_CERT_PASSWORD", "").strip()

    missing = [k for k, v in [
        ("EXCHANGE_ORGANIZATION",  org),
        ("EXCHANGE_CERT_PATH",     cert_path),
        ("EXCHANGE_CERT_PASSWORD", cert_pass),
    ] if not v]
    if missing:
        raise HTTPException(status_code=503, detail=f"Missing .env variables: {', '.join(missing)}")

    env = os.environ.copy()
    env["EXO_ORG"]                = org
    env["EXCHANGE_CERT_PATH"]     = cert_path
    env["EXCHANGE_CERT_PASSWORD"] = cert_pass
    env["MAILBOX_IDENTITY"]       = mailbox_email
    env["TERM"]                   = "dumb"

    with tempfile.NamedTemporaryFile(suffix=".ps1", mode="w", delete=False) as f:
        f.write(_EXO_PS_SCRIPT)
        ps_file = f.name

    try:
        loop = asyncio.get_event_loop()
        proc = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                ["pwsh", "-NonInteractive", "-NoProfile", "-File", ps_file],
                env=env,
                capture_output=True,
                text=True,
                timeout=90,
            ),
        )
    finally:
        os.unlink(ps_file)

    ansi_escape = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[?\??\d+[hl]|\r')
    stdout = ansi_escape.sub('', proc.stdout).strip()

    json_match = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])\s*$', stdout)
    if not json_match:
        stderr = ansi_escape.sub('', proc.stderr).strip()
        raise HTTPException(
            status_code=502,
            detail=f"PowerShell produced no JSON. stdout: {stdout[:300]} stderr: {stderr[:300]}",
        )

    try:
        data = json.loads(json_match.group(1))
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"Could not parse PowerShell output: {stdout[:400]}")

    if "error" in data:
        raise HTTPException(status_code=502, detail=f"Exchange Online: {data['error']}")

    return data


@router.get("/{mailbox_id}/permissions")
async def get_mailbox_permissions(mailbox_id: str):
    """
    Fetch Full Access, Send As, and Send on Behalf permissions for a shared mailbox
    by running Exchange Online PowerShell (requires pwsh + ExchangeOnlineManagement module).
    """
    if not is_azure_configured():
        raise HTTPException(status_code=503, detail="Azure credentials not configured.")

    user = await _graph_get(f"/users/{mailbox_id}", params={"$select": "mail,displayName"})
    mail = user.get("mail")
    if not mail:
        raise HTTPException(status_code=404, detail="Could not resolve mailbox email address.")

    return await _run_exo_permissions(mail)


@router.get("/user/{user_id}/memberships")
async def get_user_mailbox_memberships(user_id: str):
    """Return shared mailboxes (mail-enabled M365 groups) that a user is a member of."""
    if not is_azure_configured():
        raise HTTPException(status_code=503, detail="Azure credentials not configured.")

    data = await _graph_get(
        f"/users/{user_id}/memberOf",
        params={
            "$select": "id,displayName,mail,mailEnabled,groupTypes",
            "$top": "100",
        },
    )

    mailboxes = [
        {
            "id":          g.get("id"),
            "displayName": g.get("displayName"),
            "mail":        g.get("mail"),
        }
        for g in data.get("value", [])
        if g.get("mail") and g.get("mailEnabled")
    ]

    return {"mailboxes": mailboxes}
