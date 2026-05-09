import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from dotenv import load_dotenv
from pathlib import Path
from ..database import get_db
from ..models import UserRecord, Role, ALL_PERMISSIONS

BRANDING_DIR = Path(__file__).parent.parent / "uploads" / "branding"
BRANDING_DIR.mkdir(parents=True, exist_ok=True)

ENV_PATH = Path(__file__).parent.parent / ".env"


def _write_env_key(key: str, value: str):
    """Update a single key in .env."""
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    updated = False
    new_lines = []
    for line in lines:
        import re
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if m and m.group(1) == key:
            new_lines.append(f"{key}={value}")
            updated = True
        else:
            new_lines.append(line)
    if not updated:
        new_lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(new_lines) + "\n")
    load_dotenv(dotenv_path=ENV_PATH, override=True)
    os.environ[key] = value

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

from ..audit_log import log_audit

router = APIRouter(prefix="/api/settings", tags=["settings"])

ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "").split(",")
    if e.strip()
}

# When true, only pre-invited users (or ADMIN_EMAILS) can create accounts
REQUIRE_PREREGISTRATION = os.getenv("REQUIRE_PREREGISTRATION", "false").lower() == "true"

# Prefix used to identify placeholder records created by the invite endpoint
INVITE_PREFIX = "invited:"


def _is_admin_email(email: str | None) -> bool:
    return bool(email and email.lower() in ADMIN_EMAILS)


async def _upsert_user(db: AsyncSession, uid: str, first_name: str, last_name: str, email: str) -> UserRecord:
    result = await db.execute(select(UserRecord).where(UserRecord.id == uid))
    record = result.scalar_one_or_none()
    now = datetime.now(timezone.utc).isoformat()

    if record is None:
        # Check for a pre-registered (invited) placeholder keyed by email
        result2 = await db.execute(select(UserRecord).where(UserRecord.email == email))
        invited = result2.scalar_one_or_none()

        if invited and invited.id.startswith(INVITE_PREFIX):
            # Promote the placeholder to a real account using the actual Azure OID
            saved_role = invited.role
            await db.delete(invited)
            await db.flush()
            record = UserRecord(id=uid, first_name=first_name, last_name=last_name, email=email, role=saved_role, last_seen=now)
            db.add(record)
            await db.flush()
            await log_audit(db, actor=record, action="user.first_login",
                            category="auth", target_type="user", target_id=uid,
                            target_label=email,
                            detail=f"{email} signed in for the first time (accepted invite, role: {saved_role})")
        elif REQUIRE_PREREGISTRATION and not _is_admin_email(email):
            raise HTTPException(status_code=403, detail="Access not granted. Ask an admin to invite you.")
        else:
            role = "admin" if _is_admin_email(email) else "user"
            record = UserRecord(id=uid, first_name=first_name, last_name=last_name, email=email, role=role, last_seen=now)
            db.add(record)
            await db.flush()
            await log_audit(db, actor=record, action="user.first_login",
                            category="auth", target_type="user", target_id=uid,
                            target_label=email,
                            detail=f"{email} signed in for the first time (role: {role})")
    else:
        record.email     = email
        record.last_seen = now
        # Fill in names from JWT if they were never set (e.g. existing records before this feature)
        if not record.first_name and first_name:
            record.first_name = first_name
        if not record.last_name and last_name:
            record.last_name = last_name
        if _is_admin_email(email) and record.role != "admin":
            old_role = record.role
            record.role = "admin"
            await db.flush()
            await log_audit(db, actor=record, action="user.role_changed",
                            category="user_management", target_type="user", target_id=uid,
                            target_label=email,
                            detail=f"Auto-promoted to admin (email in ADMIN_EMAILS)",
                            extra={"old_role": old_role, "new_role": "admin"})

    await db.commit()
    await db.refresh(record)
    return record


async def _get_user_permissions(record: UserRecord, db: AsyncSession) -> list[str]:
    """Return the permission list for a user based on their role."""
    if record.role == "admin":
        return list(ALL_PERMISSIONS)
    role_result = await db.execute(select(Role).where(Role.name == record.role))
    role = role_result.scalar_one_or_none()
    if not role:
        return []
    return json.loads(role.permissions or "[]")


async def require_admin(request: Request, db: AsyncSession = Depends(get_db)):
    user = getattr(request.state, "user", None)
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = await db.execute(select(UserRecord).where(UserRecord.id == user["id"]))
    record = result.scalar_one_or_none()
    if not record or record.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return record


def require_permission(perm: str):
    """Dependency factory: raise 403 if the current user lacks the given permission."""
    async def _check(request: Request, db: AsyncSession = Depends(get_db)):
        user = getattr(request.state, "user", None)
        if not user or not user.get("id"):
            raise HTTPException(status_code=401, detail="Not authenticated")
        result = await db.execute(select(UserRecord).where(UserRecord.id == user["id"]))
        record = result.scalar_one_or_none()
        if not record:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if record.role == "admin":
            return record  # admin always passes
        perms = await _get_user_permissions(record, db)
        if perm not in perms:
            raise HTTPException(status_code=403, detail="Permission denied")
        return record
    return _check


@router.get("/me")
async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)):
    """Upsert the current user and return their profile + role."""
    user = getattr(request.state, "user", None)
    if not user or not user.get("id"):
        return {"id": None, "first_name": "", "last_name": "", "email": None, "role": "user", "user_type": "staff"}

    # Portal/customer users have a customer_id — don't upsert into staff records
    if user.get("customer_id"):
        return {
            "id":               user["id"],
            "first_name":       user.get("first_name", ""),
            "last_name":        user.get("last_name", ""),
            "email":            user.get("email", ""),
            "role":             "portal_user",
            "user_type":        "portal",
            "customer_id":      user["customer_id"],
            "permissions":      [],
            "rc_extension_id":  "",
            "rc_presence_access": False,
        }

    record = await _upsert_user(
        db, user["id"],
        user.get("first_name", ""),
        user.get("last_name", ""),
        user.get("email", ""),
    )
    permissions = await _get_user_permissions(record, db)
    return {
        "id": record.id, "first_name": record.first_name, "last_name": record.last_name,
        "name": record.name, "email": record.email, "role": record.role,
        "user_type":          "staff",
        "rc_extension_id":    record.rc_extension_id or "",
        "rc_presence_access": bool(record.rc_presence_access),
        "permissions":        permissions,
    }


@router.get("/branding")
async def get_branding():
    """Public — returns company branding (logo URL, favicon URL, name). Used on the login page."""
    return {
        "companyName": os.getenv("COMPANY_NAME", "Claim Assist Solutions"),
        "logoUrl":     os.getenv("COMPANY_LOGO_URL", ""),
        "faviconUrl":  os.getenv("COMPANY_FAVICON_URL", ""),
    }


@router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    ext = Path(file.filename or "").suffix.lower() or ".png"
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    for old in BRANDING_DIR.glob("logo.*"):
        old.unlink(missing_ok=True)

    filename = f"logo{ext}"
    dest = BRANDING_DIR / filename
    dest.write_bytes(await file.read())

    url = f"/uploads/branding/{filename}"
    _write_env_key("COMPANY_LOGO_URL", url)
    await log_audit(db, actor=admin, action="branding.logo_uploaded",
                    category="system_settings", target_type="branding", target_label="Company Logo",
                    detail=f"Logo updated: {file.filename}")
    await db.commit()
    return {"logoUrl": url}


@router.delete("/logo")
async def delete_logo(admin: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    for old in BRANDING_DIR.glob("logo.*"):
        old.unlink(missing_ok=True)
    _write_env_key("COMPANY_LOGO_URL", "")
    await log_audit(db, actor=admin, action="branding.logo_deleted",
                    category="system_settings", target_type="branding", target_label="Company Logo",
                    detail="Logo removed")
    await db.commit()
    return {"ok": True}


@router.post("/favicon")
async def upload_favicon(
    file: UploadFile = File(...),
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    ext = Path(file.filename or "").suffix.lower() or ".png"
    allowed = {".png", ".jpg", ".jpeg", ".ico", ".svg", ".gif", ".webp"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    for old in BRANDING_DIR.glob("favicon.*"):
        old.unlink(missing_ok=True)

    filename = f"favicon{ext}"
    dest = BRANDING_DIR / filename
    dest.write_bytes(await file.read())

    url = f"/uploads/branding/{filename}"
    _write_env_key("COMPANY_FAVICON_URL", url)
    await log_audit(db, actor=admin, action="branding.favicon_uploaded",
                    category="system_settings", target_type="branding", target_label="Favicon",
                    detail=f"Favicon updated: {file.filename}")
    await db.commit()
    return {"faviconUrl": url}


@router.delete("/favicon")
async def delete_favicon(admin: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    for old in BRANDING_DIR.glob("favicon.*"):
        old.unlink(missing_ok=True)
    _write_env_key("COMPANY_FAVICON_URL", "")
    await log_audit(db, actor=admin, action="branding.favicon_deleted",
                    category="system_settings", target_type="branding", target_label="Favicon",
                    detail="Favicon removed")
    await db.commit()
    return {"ok": True}


@router.post("/icon")
async def upload_icon(
    file: UploadFile = File(...),
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    ext = Path(file.filename or "").suffix.lower() or ".png"
    allowed = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    for old in BRANDING_DIR.glob("icon.*"):
        old.unlink(missing_ok=True)

    filename = f"icon{ext}"
    dest = BRANDING_DIR / filename
    dest.write_bytes(await file.read())

    url = f"/uploads/branding/{filename}"
    _write_env_key("COMPANY_ICON_URL", url)
    await log_audit(db, actor=admin, action="branding.icon_uploaded",
                    category="system_settings", target_type="branding", target_label="Header Icon",
                    detail=f"Header icon updated: {file.filename}")
    await db.commit()
    return {"iconUrl": url}


@router.delete("/icon")
async def delete_icon(admin: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    for old in BRANDING_DIR.glob("icon.*"):
        old.unlink(missing_ok=True)
    _write_env_key("COMPANY_ICON_URL", "")
    await log_audit(db, actor=admin, action="branding.icon_deleted",
                    category="system_settings", target_type="branding", target_label="Header Icon",
                    detail="Header icon removed")
    await db.commit()
    return {"ok": True}


@router.get("/config")
async def get_config():
    """Return read-only portal / auth configuration."""
    return {
        "portalName":     "ControlPoint",
        "companyName":    os.getenv("COMPANY_NAME", "Claim Assist Solutions"),
        "logoUrl":        os.getenv("COMPANY_LOGO_URL", ""),
        "faviconUrl":     os.getenv("COMPANY_FAVICON_URL", ""),
        "iconUrl":        os.getenv("COMPANY_ICON_URL", ""),
        "tenantId":       os.getenv("AZURE_TENANT_ID", ""),
        "clientId":       os.getenv("AZURE_CLIENT_ID", ""),
        "azurePortalUrl": (
            f"https://portal.azure.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade"
            f"/~/Overview/objectId//appId/{os.getenv('AZURE_CLIENT_ID', '')}"
        ),
    }


class UserInvite(BaseModel):
    email: str


class RoleUpdate(BaseModel):
    role: str  # 'admin' | 'user'


class ProfileUpdate(BaseModel):
    first_name: str
    last_name: str
    rc_extension_id: str | None = None


@router.get("/users")
async def list_users(_: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Admin only: list all registered users."""
    result = await db.execute(select(UserRecord).order_by(UserRecord.last_name, UserRecord.first_name))
    rows = result.scalars().all()
    return [
        {
            "id": r.id, "first_name": r.first_name, "last_name": r.last_name,
            "name": r.name, "email": r.email, "role": r.role, "last_seen": r.last_seen,
            "rc_extension_id":    r.rc_extension_id or "",
            "rc_presence_access": bool(r.rc_presence_access),
            "invited": r.id.startswith(INVITE_PREFIX),
        }
        for r in rows
    ]


@router.post("/users")
async def invite_user(
    body: UserInvite,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin only: pre-register a user by email so they can sign in."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email is required")
    result = await db.execute(select(UserRecord).where(UserRecord.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User already registered or invited")
    role = "admin" if _is_admin_email(email) else "user"
    record = UserRecord(
        id=f"{INVITE_PREFIX}{uuid.uuid4()}",
        first_name="", last_name="",
        email=email, role=role, last_seen=None,
    )
    db.add(record)
    await db.flush()
    await log_audit(db, actor=admin, action="user.invited",
                    category="user_management", target_type="user", target_label=email,
                    detail=f"{admin.email} invited {email} (role: {role})",
                    extra={"invited_email": email, "role": role})
    await db.commit()
    await db.refresh(record)
    return {
        "id": record.id, "first_name": "", "last_name": "", "name": email,
        "email": record.email, "role": record.role, "last_seen": None, "invited": True,
    }


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin only: remove a user or rescind an invite."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    result = await db.execute(select(UserRecord).where(UserRecord.id == user_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="User not found")
    was_invite = record.id.startswith(INVITE_PREFIX)
    label = record.email
    role  = record.role
    await db.delete(record)
    await db.flush()
    await log_audit(db, actor=admin, action="user.invite_rescinded" if was_invite else "user.deleted",
                    category="user_management", target_type="user", target_id=user_id,
                    target_label=label,
                    detail=f"{admin.email} {'rescinded invite for' if was_invite else 'deleted user'} {label} (role: {role})",
                    extra={"deleted_email": label, "role": role, "was_invite": was_invite})
    await db.commit()
    return {"ok": True}


@router.put("/users/{user_id}/profile")
async def update_user_profile(
    user_id: str,
    body: ProfileUpdate,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin only: update a user's name."""
    result = await db.execute(select(UserRecord).where(UserRecord.id == user_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="User not found")
    changes = {}
    old_name = f"{record.first_name or ''} {record.last_name or ''}".strip()
    new_name = f"{body.first_name.strip()} {body.last_name.strip()}".strip()
    if old_name != new_name:
        changes["name"] = {"from": old_name, "to": new_name}
    old_ext = record.rc_extension_id or ""
    new_ext = (body.rc_extension_id or "").strip()
    if old_ext != new_ext:
        changes["rc_extension_id"] = {"from": old_ext, "to": new_ext}
    record.first_name      = body.first_name.strip()
    record.last_name       = body.last_name.strip()
    record.rc_extension_id = new_ext or None
    if changes:
        await log_audit(db, actor=admin, action="user.profile_updated",
                        category="user_management", target_type="user", target_id=user_id,
                        target_label=record.email,
                        detail=f"{admin.email} updated profile for {record.email}: " +
                               ", ".join(f"{k} → {v['to']}" for k, v in changes.items()),
                        extra={"changes": changes})
    await db.commit()
    return {
        "id": record.id, "first_name": record.first_name, "last_name": record.last_name,
        "name": record.name, "email": record.email, "role": record.role,
        "rc_extension_id": record.rc_extension_id or "",
    }


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: RoleUpdate,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin only: change a user's role."""
    role_result = await db.execute(select(Role).where(Role.name == body.role))
    if not role_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Role '{body.role}' does not exist")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    result = await db.execute(select(UserRecord).where(UserRecord.id == user_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="User not found")
    old_role = record.role
    record.role = body.role
    await log_audit(db, actor=admin, action="user.role_changed",
                    category="user_management", target_type="user", target_id=user_id,
                    target_label=record.email,
                    detail=f"{admin.email} changed role for {record.email}: {old_role} → {body.role}",
                    extra={"old_role": old_role, "new_role": body.role})
    await db.commit()
    return {"id": record.id, "name": record.name, "email": record.email, "role": record.role}


class RCAccessUpdate(BaseModel):
    enabled: bool


class AdminPasswordIn(BaseModel):
    password: str


@router.put("/users/{user_id}/password")
async def admin_set_user_password(
    user_id: str,
    body: AdminPasswordIn,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin only: set (or clear) a staff user's local password."""
    result = await db.execute(select(UserRecord).where(UserRecord.id == user_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="User not found")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    record.password_hash = hashlib.sha256(body.password.encode()).hexdigest()
    await log_audit(db, actor=admin, action="user.password_set",
                    category="user_management", target_type="user", target_id=user_id,
                    target_label=record.email,
                    detail=f"{admin.email} set local password for {record.email}")
    await db.commit()
    return {"ok": True}


@router.put("/users/{user_id}/rc-access")
async def update_user_rc_access(
    user_id: str,
    body: RCAccessUpdate,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin only: grant or revoke RC Presence page access for a user."""
    result = await db.execute(select(UserRecord).where(UserRecord.id == user_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="User not found")
    record.rc_presence_access = body.enabled
    await log_audit(db, actor=admin, action="user.rc_access_changed",
                    category="user_management", target_type="user", target_id=user_id,
                    target_label=record.email,
                    detail=f"{admin.email} {'granted' if body.enabled else 'revoked'} RC Presence access for {record.email}")
    await db.commit()
    return {
        "id": record.id, "name": record.name, "email": record.email,
        "rc_presence_access": bool(record.rc_presence_access),
    }
