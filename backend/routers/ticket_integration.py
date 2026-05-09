"""
External ticket system integration adapter.
Normalizes Freshservice, Jira, ServiceNow, and Zendesk into a unified API
so the frontend doesn't care which provider the tenant uses.
"""
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import TicketSystemConfig

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

router = APIRouter(prefix="/api/ticket-integration", tags=["ticket-integration"])

# ── Config helpers ────────────────────────────────────────────────────────────

_DEFAULT_CFG: dict = {
    "native_ticketing_enabled": False,
    "external_provider": None,      # "freshservice" | "jira" | "servicenow" | "zendesk"
    "external_config": {},          # provider-specific credentials
}

async def _get_cfg(db: AsyncSession) -> dict:
    row = (await db.execute(
        select(TicketSystemConfig).where(TicketSystemConfig.id == 1)
    )).scalar_one_or_none()
    if not row:
        return dict(_DEFAULT_CFG)
    try:
        stored = json.loads(row.settings)
        return {**_DEFAULT_CFG, **stored}
    except Exception:
        return dict(_DEFAULT_CFG)

def _provider_cfg(cfg: dict) -> dict:
    return cfg.get("external_config", {}).get(cfg.get("external_provider", ""), {})

def _require_auth(request: Request):
    if not getattr(request.state, "user", None):
        raise HTTPException(401, "Authentication required")

# ── Normalised ticket schema ──────────────────────────────────────────────────
#
#  {
#    id, subject, description, status, priority, type,
#    requester_email, requester_name, assignee_name,
#    created_at, updated_at, url, provider
#  }
#
# ── Freshservice adapter ──────────────────────────────────────────────────────

_FS_STATUS = {2: "open", 3: "pending", 4: "resolved", 5: "closed",
              6: "waiting_on_customer", 7: "waiting_on_third_party"}
_FS_STATUS_R = {"open": 2, "pending": 3, "resolved": 4, "closed": 5,
                "waiting_on_customer": 6, "waiting_on_third_party": 7, "in_progress": 2}
_FS_PRI = {1: "low", 2: "medium", 3: "high", 4: "urgent"}
_FS_PRI_R = {"low": 1, "medium": 2, "high": 3, "urgent": 4}

def _fs_headers(pcfg: dict) -> dict:
    import base64
    creds = base64.b64encode(f"{pcfg['api_key']}:X".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

def _fs_base(pcfg: dict) -> str:
    return f"https://{pcfg['domain']}/api/v2"

def _fs_normalize(t: dict, domain: str) -> dict:
    return {
        "id":               str(t["id"]),
        "subject":          t.get("subject", ""),
        "description":      t.get("description_text") or t.get("description") or "",
        "status":           _FS_STATUS.get(t.get("status", 2), "open"),
        "priority":         _FS_PRI.get(t.get("priority", 2), "medium"),
        "type":             (t.get("type") or "incident").lower().replace(" ", "_"),
        "requester_email":  t.get("requester", {}).get("email") or "",
        "requester_name":   (t.get("requester", {}).get("name") or "").strip(),
        "assignee_name":    (t.get("responder", {}).get("name") or "").strip(),
        "created_at":       t.get("created_at", ""),
        "updated_at":       t.get("updated_at", ""),
        "url":              f"https://{domain}/helpdesk/tickets/{t['id']}",
        "provider":         "freshservice",
        "tags":             t.get("tags", []),
    }

async def _fs_list(pcfg: dict, params: dict) -> list[dict]:
    page, per = 1, 30
    status_filter = params.get("status")
    results = []
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            qp = {"page": page, "per_page": per, "include": "requester,responder"}
            if status_filter and status_filter != "all":
                fs_status = _FS_STATUS_R.get(status_filter, 2)
                qp["status"] = fs_status
            resp = await client.get(f"{_fs_base(pcfg)}/tickets", headers=_fs_headers(pcfg), params=qp)
            resp.raise_for_status()
            batch = resp.json().get("tickets", [])
            results.extend([_fs_normalize(t, pcfg["domain"]) for t in batch])
            if len(batch) < per:
                break
            page += 1
            if page > 10:
                break
    return results

async def _fs_get(pcfg: dict, ticket_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{_fs_base(pcfg)}/tickets/{ticket_id}",
            headers=_fs_headers(pcfg),
            params={"include": "requester,responder,conversations"}
        )
        resp.raise_for_status()
        data = resp.json()["ticket"]
        result = _fs_normalize(data, pcfg["domain"])
        result["comments"] = [
            {
                "id":         str(c["id"]),
                "body":       c.get("body_text") or c.get("body") or "",
                "author":     c.get("user", {}).get("name", "Agent"),
                "created_at": c.get("created_at", ""),
                "private":    c.get("private", False),
            }
            for c in data.get("conversations", [])
        ]
        return result

async def _fs_create(pcfg: dict, payload: dict) -> dict:
    body = {
        "subject":     payload["subject"],
        "description": payload.get("description", ""),
        "email":       payload.get("requester_email", ""),
        "status":      _FS_STATUS_R.get(payload.get("status", "open"), 2),
        "priority":    _FS_PRI_R.get(payload.get("priority", "medium"), 2),
        "type":        payload.get("type", "Incident").replace("_", " ").title(),
        "tags":        payload.get("tags", []),
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{_fs_base(pcfg)}/tickets", headers=_fs_headers(pcfg), json=body)
        resp.raise_for_status()
        return _fs_normalize(resp.json()["ticket"], pcfg["domain"])

async def _fs_update(pcfg: dict, ticket_id: str, payload: dict) -> dict:
    body = {}
    if "subject" in payload:
        body["subject"] = payload["subject"]
    if "description" in payload:
        body["description"] = payload["description"]
    if "status" in payload:
        body["status"] = _FS_STATUS_R.get(payload["status"], 2)
    if "priority" in payload:
        body["priority"] = _FS_PRI_R.get(payload["priority"], 2)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            f"{_fs_base(pcfg)}/tickets/{ticket_id}",
            headers=_fs_headers(pcfg), json=body
        )
        resp.raise_for_status()
        return _fs_normalize(resp.json()["ticket"], pcfg["domain"])

async def _fs_comment(pcfg: dict, ticket_id: str, body: str, private: bool) -> dict:
    payload = {"body": body, "private": private}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_fs_base(pcfg)}/tickets/{ticket_id}/conversations",
            headers=_fs_headers(pcfg), json=payload
        )
        resp.raise_for_status()
        c = resp.json()["conversation"]
        return {
            "id":         str(c["id"]),
            "body":       c.get("body_text") or c.get("body") or "",
            "author":     c.get("user", {}).get("name", "Agent"),
            "created_at": c.get("created_at", ""),
            "private":    c.get("private", False),
        }

# ── Jira adapter ──────────────────────────────────────────────────────────────

_JIRA_STATUS = {
    "to do": "open", "open": "open", "in progress": "in_progress",
    "done": "resolved", "closed": "closed", "resolved": "resolved",
    "waiting for customer": "waiting_on_customer", "pending": "pending",
}
_JIRA_PRI = {"lowest": "low", "low": "low", "medium": "medium", "high": "high", "highest": "urgent", "critical": "urgent"}

def _jira_headers(pcfg: dict) -> dict:
    import base64
    creds = base64.b64encode(f"{pcfg['email']}:{pcfg['api_token']}".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json", "Accept": "application/json"}

def _jira_base(pcfg: dict) -> str:
    return pcfg["base_url"].rstrip("/")

def _jira_normalize(issue: dict, base_url: str) -> dict:
    fields = issue.get("fields", {})
    status_name = (fields.get("status", {}).get("name") or "open").lower()
    pri_name = (fields.get("priority", {}).get("name") or "medium").lower()
    assignee = fields.get("assignee") or {}
    reporter = fields.get("reporter") or {}
    return {
        "id":               issue["key"],
        "subject":          fields.get("summary", ""),
        "description":      (fields.get("description") or {}).get("text", "") if isinstance(fields.get("description"), dict) else str(fields.get("description") or ""),
        "status":           _JIRA_STATUS.get(status_name, "open"),
        "priority":         _JIRA_PRI.get(pri_name, "medium"),
        "type":             (fields.get("issuetype", {}).get("name") or "incident").lower().replace(" ", "_"),
        "requester_email":  reporter.get("emailAddress", ""),
        "requester_name":   reporter.get("displayName", ""),
        "assignee_name":    assignee.get("displayName", ""),
        "created_at":       fields.get("created", ""),
        "updated_at":       fields.get("updated", ""),
        "url":              f"{base_url}/browse/{issue['key']}",
        "provider":         "jira",
        "tags":             [l["name"] for l in (fields.get("labels") or [])],
    }

async def _jira_list(pcfg: dict, params: dict) -> list[dict]:
    base = _jira_base(pcfg)
    status_filter = params.get("status")
    jql = f"project = \"{pcfg.get('project', '')}\"" if pcfg.get("project") else "order by created DESC"
    if status_filter and status_filter not in ("all", ""):
        if status_filter == "open":
            jql += " AND statusCategory != Done"
        elif status_filter == "resolved":
            jql += " AND statusCategory = Done"
    jql += " ORDER BY created DESC"
    results, start = [], 0
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            resp = await client.get(
                f"{base}/rest/api/3/search",
                headers=_jira_headers(pcfg),
                params={"jql": jql, "startAt": start, "maxResults": 50,
                        "fields": "summary,status,priority,issuetype,assignee,reporter,created,updated,labels,description"}
            )
            resp.raise_for_status()
            data = resp.json()
            issues = data.get("issues", [])
            results.extend([_jira_normalize(i, base) for i in issues])
            start += len(issues)
            if start >= data.get("total", 0) or len(issues) == 0:
                break
            if len(results) >= 200:
                break
    return results

async def _jira_get(pcfg: dict, ticket_id: str) -> dict:
    base = _jira_base(pcfg)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}/rest/api/3/issue/{ticket_id}",
            headers=_jira_headers(pcfg),
            params={"fields": "summary,status,priority,issuetype,assignee,reporter,created,updated,labels,description,comment"}
        )
        resp.raise_for_status()
        issue = resp.json()
        result = _jira_normalize(issue, base)
        comments_data = issue.get("fields", {}).get("comment", {}).get("comments", [])
        result["comments"] = [
            {
                "id":         c["id"],
                "body":       (c.get("body") or {}).get("text", "") if isinstance(c.get("body"), dict) else str(c.get("body") or ""),
                "author":     c.get("author", {}).get("displayName", ""),
                "created_at": c.get("created", ""),
                "private":    False,
            }
            for c in comments_data
        ]
        return result

async def _jira_create(pcfg: dict, payload: dict) -> dict:
    base = _jira_base(pcfg)
    body = {
        "fields": {
            "project":     {"key": pcfg.get("project", "")},
            "summary":     payload["subject"],
            "description": {"type": "doc", "version": 1, "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": payload.get("description", "")}]}
            ]},
            "issuetype":   {"name": payload.get("type", "incident").replace("_", " ").title()},
            "priority":    {"name": payload.get("priority", "medium").title()},
        }
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{base}/rest/api/3/issue", headers=_jira_headers(pcfg), json=body)
        resp.raise_for_status()
        return await _jira_get(pcfg, resp.json()["key"])

async def _jira_update(pcfg: dict, ticket_id: str, payload: dict) -> dict:
    base = _jira_base(pcfg)
    fields: dict = {}
    if "subject" in payload:
        fields["summary"] = payload["subject"]
    if "priority" in payload:
        fields["priority"] = {"name": payload["priority"].title()}
    if "description" in payload:
        fields["description"] = {"type": "doc", "version": 1, "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": payload["description"]}]}
        ]}
    transitions: dict | None = None
    if "status" in payload:
        # Look up the transition ID that matches the desired status
        async with httpx.AsyncClient(timeout=10) as client:
            tr = await client.get(f"{base}/rest/api/3/issue/{ticket_id}/transitions", headers=_jira_headers(pcfg))
            tr.raise_for_status()
            for t in tr.json().get("transitions", []):
                if payload["status"].lower().replace("_", " ") in t["name"].lower():
                    transitions = {"transition": {"id": t["id"]}}
                    break
    async with httpx.AsyncClient(timeout=15) as client:
        if fields:
            r = await client.put(f"{base}/rest/api/3/issue/{ticket_id}", headers=_jira_headers(pcfg), json={"fields": fields})
            r.raise_for_status()
        if transitions:
            r = await client.post(f"{base}/rest/api/3/issue/{ticket_id}/transitions", headers=_jira_headers(pcfg), json=transitions)
            r.raise_for_status()
    return await _jira_get(pcfg, ticket_id)

async def _jira_comment(pcfg: dict, ticket_id: str, body: str, private: bool) -> dict:
    base = _jira_base(pcfg)
    payload = {"body": {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": body}]}
    ]}}
    if private:
        payload["visibility"] = {"type": "role", "value": "Service Desk Team"}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{base}/rest/api/3/issue/{ticket_id}/comment", headers=_jira_headers(pcfg), json=payload)
        resp.raise_for_status()
        c = resp.json()
        return {
            "id":         c["id"],
            "body":       (c.get("body") or {}).get("text", "") if isinstance(c.get("body"), dict) else str(c.get("body") or ""),
            "author":     c.get("author", {}).get("displayName", ""),
            "created_at": c.get("created", ""),
            "private":    private,
        }

# ── ServiceNow adapter ────────────────────────────────────────────────────────

_SN_STATE = {"1": "open", "2": "in_progress", "3": "pending", "6": "resolved", "7": "closed"}
_SN_STATE_R = {"open": "1", "in_progress": "2", "pending": "3", "resolved": "6", "closed": "7"}
_SN_PRI = {"1": "urgent", "2": "high", "3": "medium", "4": "low", "5": "low"}
_SN_PRI_R = {"urgent": "1", "high": "2", "medium": "3", "low": "4"}

def _sn_headers(pcfg: dict) -> dict:
    import base64
    creds = base64.b64encode(f"{pcfg['username']}:{pcfg['password']}".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json", "Accept": "application/json"}

def _sn_base(pcfg: dict) -> str:
    return f"https://{pcfg['instance']}.service-now.com"

def _sn_normalize(rec: dict, base_url: str) -> dict:
    state_val = str(rec.get("state", {}).get("value", "1") if isinstance(rec.get("state"), dict) else rec.get("state", "1"))
    pri_val   = str(rec.get("priority", {}).get("value", "3") if isinstance(rec.get("priority"), dict) else rec.get("priority", "3"))
    return {
        "id":               rec.get("sys_id", ""),
        "subject":          rec.get("short_description", ""),
        "description":      rec.get("description", ""),
        "status":           _SN_STATE.get(state_val, "open"),
        "priority":         _SN_PRI.get(pri_val, "medium"),
        "type":             "incident",
        "requester_email":  "",
        "requester_name":   rec.get("caller_id", {}).get("display_value", "") if isinstance(rec.get("caller_id"), dict) else "",
        "assignee_name":    rec.get("assigned_to", {}).get("display_value", "") if isinstance(rec.get("assigned_to"), dict) else "",
        "created_at":       rec.get("sys_created_on", ""),
        "updated_at":       rec.get("sys_updated_on", ""),
        "url":              f"{base_url}/nav_to.do?uri=incident.do?sys_id={rec.get('sys_id', '')}",
        "provider":         "servicenow",
        "tags":             [],
    }

async def _sn_list(pcfg: dict, params: dict) -> list[dict]:
    base = _sn_base(pcfg)
    status_filter = params.get("status")
    qp = {"sysparm_limit": 100, "sysparm_display_value": "true",
          "sysparm_fields": "sys_id,short_description,description,state,priority,caller_id,assigned_to,sys_created_on,sys_updated_on"}
    if status_filter and status_filter not in ("all", ""):
        qp["sysparm_query"] = f"state={_SN_STATE_R.get(status_filter, '1')}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{base}/api/now/table/incident", headers=_sn_headers(pcfg), params=qp)
        resp.raise_for_status()
        return [_sn_normalize(r, base) for r in resp.json().get("result", [])]

async def _sn_get(pcfg: dict, ticket_id: str) -> dict:
    base = _sn_base(pcfg)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}/api/now/table/incident/{ticket_id}",
            headers=_sn_headers(pcfg),
            params={"sysparm_display_value": "true"}
        )
        resp.raise_for_status()
        result = _sn_normalize(resp.json()["result"], base)
        # Fetch comments via journal entries
        cjr = await client.get(
            f"{base}/api/now/table/sys_journal_field",
            headers=_sn_headers(pcfg),
            params={"sysparm_query": f"element_id={ticket_id}^element=comments^ORDERBYDESCsys_created_on",
                    "sysparm_limit": 50, "sysparm_display_value": "true"}
        )
        result["comments"] = [
            {
                "id":         c.get("sys_id", ""),
                "body":       c.get("value", ""),
                "author":     c.get("sys_created_by", ""),
                "created_at": c.get("sys_created_on", ""),
                "private":    False,
            }
            for c in (cjr.json().get("result", []) if cjr.is_success else [])
        ]
        return result

async def _sn_create(pcfg: dict, payload: dict) -> dict:
    base = _sn_base(pcfg)
    body = {
        "short_description": payload["subject"],
        "description":       payload.get("description", ""),
        "state":             _SN_STATE_R.get(payload.get("status", "open"), "1"),
        "priority":          _SN_PRI_R.get(payload.get("priority", "medium"), "3"),
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{base}/api/now/table/incident", headers=_sn_headers(pcfg), json=body)
        resp.raise_for_status()
        return _sn_normalize(resp.json()["result"], base)

async def _sn_update(pcfg: dict, ticket_id: str, payload: dict) -> dict:
    base = _sn_base(pcfg)
    body = {}
    if "subject" in payload:
        body["short_description"] = payload["subject"]
    if "description" in payload:
        body["description"] = payload["description"]
    if "status" in payload:
        body["state"] = _SN_STATE_R.get(payload["status"], "1")
    if "priority" in payload:
        body["priority"] = _SN_PRI_R.get(payload["priority"], "3")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(f"{base}/api/now/table/incident/{ticket_id}", headers=_sn_headers(pcfg), json=body)
        resp.raise_for_status()
        return _sn_normalize(resp.json()["result"], base)

async def _sn_comment(pcfg: dict, ticket_id: str, body: str, private: bool) -> dict:
    base = _sn_base(pcfg)
    field = "work_notes" if private else "comments"
    payload = {field: body}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(f"{base}/api/now/table/incident/{ticket_id}", headers=_sn_headers(pcfg), json=payload)
        resp.raise_for_status()
        return {"id": "", "body": body, "author": "You", "created_at": "", "private": private}

# ── Zendesk adapter ───────────────────────────────────────────────────────────

_ZD_STATUS = {"new": "open", "open": "open", "pending": "pending", "hold": "waiting_on_third_party",
              "solved": "resolved", "closed": "closed"}
_ZD_STATUS_R = {"open": "open", "pending": "pending", "resolved": "solved", "closed": "closed",
                "in_progress": "open", "waiting_on_third_party": "hold"}
_ZD_PRI = {"low": "low", "normal": "medium", "high": "high", "urgent": "urgent"}
_ZD_PRI_R = {"low": "low", "medium": "normal", "high": "high", "urgent": "urgent"}

def _zd_headers(pcfg: dict) -> dict:
    import base64
    creds = base64.b64encode(f"{pcfg['email']}/token:{pcfg['api_token']}".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

def _zd_base(pcfg: dict) -> str:
    return f"https://{pcfg['subdomain']}.zendesk.com"

def _zd_normalize(t: dict, base_url: str) -> dict:
    return {
        "id":               str(t["id"]),
        "subject":          t.get("subject", ""),
        "description":      t.get("description", ""),
        "status":           _ZD_STATUS.get(t.get("status", "open"), "open"),
        "priority":         _ZD_PRI.get(t.get("priority") or "normal", "medium"),
        "type":             (t.get("type") or "incident").lower(),
        "requester_email":  "",
        "requester_name":   "",
        "assignee_name":    "",
        "created_at":       t.get("created_at", ""),
        "updated_at":       t.get("updated_at", ""),
        "url":              f"{base_url}/agent/tickets/{t['id']}",
        "provider":         "zendesk",
        "tags":             t.get("tags", []),
    }

async def _zd_list(pcfg: dict, params: dict) -> list[dict]:
    base = _zd_base(pcfg)
    status_filter = params.get("status")
    results, page = [], 1
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            qp: dict = {"page": page, "per_page": 100}
            if status_filter and status_filter not in ("all", ""):
                qp["status"] = _ZD_STATUS_R.get(status_filter, "open")
            resp = await client.get(f"{base}/api/v2/tickets", headers=_zd_headers(pcfg), params=qp)
            resp.raise_for_status()
            data = resp.json()
            batch = data.get("tickets", [])
            results.extend([_zd_normalize(t, base) for t in batch])
            if not data.get("next_page") or len(batch) == 0:
                break
            page += 1
            if len(results) >= 300:
                break
    return results

async def _zd_get(pcfg: dict, ticket_id: str) -> dict:
    base = _zd_base(pcfg)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{base}/api/v2/tickets/{ticket_id}", headers=_zd_headers(pcfg))
        resp.raise_for_status()
        result = _zd_normalize(resp.json()["ticket"], base)
        cr = await client.get(f"{base}/api/v2/tickets/{ticket_id}/comments", headers=_zd_headers(pcfg))
        result["comments"] = [
            {
                "id":         str(c["id"]),
                "body":       c.get("plain_body") or c.get("body", ""),
                "author":     str(c.get("author_id", "")),
                "created_at": c.get("created_at", ""),
                "private":    not c.get("public", True),
            }
            for c in (cr.json().get("comments", []) if cr.is_success else [])
        ]
        return result

async def _zd_create(pcfg: dict, payload: dict) -> dict:
    base = _zd_base(pcfg)
    body = {"ticket": {
        "subject":   payload["subject"],
        "comment":   {"body": payload.get("description", "")},
        "status":    _ZD_STATUS_R.get(payload.get("status", "open"), "open"),
        "priority":  _ZD_PRI_R.get(payload.get("priority", "medium"), "normal"),
        "type":      payload.get("type", "incident"),
        "tags":      payload.get("tags", []),
    }}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{base}/api/v2/tickets", headers=_zd_headers(pcfg), json=body)
        resp.raise_for_status()
        return _zd_normalize(resp.json()["ticket"], base)

async def _zd_update(pcfg: dict, ticket_id: str, payload: dict) -> dict:
    base = _zd_base(pcfg)
    body: dict = {"ticket": {}}
    if "subject" in payload:
        body["ticket"]["subject"] = payload["subject"]
    if "status" in payload:
        body["ticket"]["status"] = _ZD_STATUS_R.get(payload["status"], "open")
    if "priority" in payload:
        body["ticket"]["priority"] = _ZD_PRI_R.get(payload["priority"], "normal")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(f"{base}/api/v2/tickets/{ticket_id}", headers=_zd_headers(pcfg), json=body)
        resp.raise_for_status()
        return _zd_normalize(resp.json()["ticket"], base)

async def _zd_comment(pcfg: dict, ticket_id: str, body: str, private: bool) -> dict:
    base = _zd_base(pcfg)
    payload = {"ticket": {"comment": {"body": body, "public": not private}}}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(f"{base}/api/v2/tickets/{ticket_id}", headers=_zd_headers(pcfg), json=payload)
        resp.raise_for_status()
        return {"id": "", "body": body, "author": "You", "created_at": "", "private": private}

# ── Dispatch ─────────────────────────────────────────────────────────────────

async def _dispatch_list(provider: str, pcfg: dict, params: dict) -> list[dict]:
    if provider == "freshservice":
        return await _fs_list(pcfg, params)
    if provider == "jira":
        return await _jira_list(pcfg, params)
    if provider == "servicenow":
        return await _sn_list(pcfg, params)
    if provider == "zendesk":
        return await _zd_list(pcfg, params)
    raise HTTPException(400, f"Unknown provider: {provider}")

async def _dispatch_get(provider: str, pcfg: dict, ticket_id: str) -> dict:
    if provider == "freshservice":
        return await _fs_get(pcfg, ticket_id)
    if provider == "jira":
        return await _jira_get(pcfg, ticket_id)
    if provider == "servicenow":
        return await _sn_get(pcfg, ticket_id)
    if provider == "zendesk":
        return await _zd_get(pcfg, ticket_id)
    raise HTTPException(400, f"Unknown provider: {provider}")

async def _dispatch_create(provider: str, pcfg: dict, payload: dict) -> dict:
    if provider == "freshservice":
        return await _fs_create(pcfg, payload)
    if provider == "jira":
        return await _jira_create(pcfg, payload)
    if provider == "servicenow":
        return await _sn_create(pcfg, payload)
    if provider == "zendesk":
        return await _zd_create(pcfg, payload)
    raise HTTPException(400, f"Unknown provider: {provider}")

async def _dispatch_update(provider: str, pcfg: dict, ticket_id: str, payload: dict) -> dict:
    if provider == "freshservice":
        return await _fs_update(pcfg, ticket_id, payload)
    if provider == "jira":
        return await _jira_update(pcfg, ticket_id, payload)
    if provider == "servicenow":
        return await _sn_update(pcfg, ticket_id, payload)
    if provider == "zendesk":
        return await _zd_update(pcfg, ticket_id, payload)
    raise HTTPException(400, f"Unknown provider: {provider}")

async def _dispatch_comment(provider: str, pcfg: dict, ticket_id: str, body: str, private: bool) -> dict:
    if provider == "freshservice":
        return await _fs_comment(pcfg, ticket_id, body, private)
    if provider == "jira":
        return await _jira_comment(pcfg, ticket_id, body, private)
    if provider == "servicenow":
        return await _sn_comment(pcfg, ticket_id, body, private)
    if provider == "zendesk":
        return await _zd_comment(pcfg, ticket_id, body, private)
    raise HTTPException(400, f"Unknown provider: {provider}")

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/mode")
async def get_mode(db: AsyncSession = Depends(get_db)):
    """Return which ticketing mode is active for this tenant."""
    cfg = await _get_cfg(db)
    native   = bool(cfg.get("native_ticketing_enabled", False))
    provider = cfg.get("external_provider") or None
    ext_cfg  = cfg.get("external_config", {})
    configured = bool(provider and ext_cfg.get(provider))
    return {
        "mode":       "native" if native else ("integration" if configured else "none"),
        "native":     native,
        "provider":   provider,
        "configured": configured,
    }

@router.get("/tickets")
async def list_tickets(
    request: Request,
    status: str = "all",
    db: AsyncSession = Depends(get_db),
):
    _require_auth(request)
    cfg      = await _get_cfg(db)
    provider = cfg.get("external_provider")
    pcfg     = _provider_cfg(cfg)
    if not provider or not pcfg:
        raise HTTPException(503, "No external ticket provider configured")
    tickets = await _dispatch_list(provider, pcfg, {"status": status})
    return {"tickets": tickets, "provider": provider, "total": len(tickets)}

@router.get("/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _require_auth(request)
    cfg      = await _get_cfg(db)
    provider = cfg.get("external_provider")
    pcfg     = _provider_cfg(cfg)
    if not provider or not pcfg:
        raise HTTPException(503, "No external ticket provider configured")
    return await _dispatch_get(provider, pcfg, ticket_id)

@router.post("/tickets")
async def create_ticket(
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _require_auth(request)
    cfg      = await _get_cfg(db)
    provider = cfg.get("external_provider")
    pcfg     = _provider_cfg(cfg)
    if not provider or not pcfg:
        raise HTTPException(503, "No external ticket provider configured")
    if not body.get("subject"):
        raise HTTPException(422, "subject is required")
    return await _dispatch_create(provider, pcfg, body)

@router.patch("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _require_auth(request)
    cfg      = await _get_cfg(db)
    provider = cfg.get("external_provider")
    pcfg     = _provider_cfg(cfg)
    if not provider or not pcfg:
        raise HTTPException(503, "No external ticket provider configured")
    return await _dispatch_update(provider, pcfg, ticket_id, body)

@router.post("/tickets/{ticket_id}/comments")
async def add_comment(
    ticket_id: str,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _require_auth(request)
    cfg      = await _get_cfg(db)
    provider = cfg.get("external_provider")
    pcfg     = _provider_cfg(cfg)
    if not provider or not pcfg:
        raise HTTPException(503, "No external ticket provider configured")
    text    = body.get("body", "").strip()
    private = bool(body.get("private", False))
    if not text:
        raise HTTPException(422, "body is required")
    return await _dispatch_comment(provider, pcfg, ticket_id, text, private)

@router.put("/config")
async def save_integration_config(
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Save external provider credentials. Admin only."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Authentication required")
    allowed = {"freshservice", "jira", "servicenow", "zendesk"}
    provider = body.get("provider")
    if provider and provider not in allowed:
        raise HTTPException(422, f"provider must be one of {allowed}")
    row = (await db.execute(select(TicketSystemConfig).where(TicketSystemConfig.id == 1))).scalar_one_or_none()
    if not row:
        row = TicketSystemConfig(id=1, settings="{}")
        db.add(row)
    existing = json.loads(row.settings) if row.settings else {}
    if provider:
        existing["external_provider"] = provider
    if "config" in body:
        ext_cfg = existing.get("external_config", {})
        ext_cfg[provider or existing.get("external_provider", "")] = body["config"]
        existing["external_config"] = ext_cfg
    row.settings = json.dumps(existing)
    await db.commit()
    return {"ok": True}
