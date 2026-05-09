import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Role, UserRecord, ALL_PERMISSIONS
from .settings import require_admin
from ..audit_log import log_audit

router = APIRouter(prefix="/api/roles", tags=["roles"])


class RoleCreate(BaseModel):
    name:        str
    label:       str
    description: str = ""
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    label:       str | None = None
    description: str | None = None
    permissions: list[str] | None = None


def _role_out(role: Role) -> dict:
    return {
        "name":        role.name,
        "label":       role.label,
        "description": role.description,
        "is_system":   bool(role.is_system),
        "permissions": json.loads(role.permissions or "[]"),
    }


@router.get("/")
async def list_roles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Role))
    roles = result.scalars().all()
    # Return system roles first, then custom roles alphabetically
    system_order = ["admin", "net_inf_team", "service_desk", "applications_team", "network_viewer", "user"]
    def sort_key(r):
        try:
            return (0, system_order.index(r.name))
        except ValueError:
            return (1, r.label.lower())
    return [_role_out(r) for r in sorted(roles, key=sort_key)]


@router.get("/permissions")
async def list_permissions():
    """Return all available permission keys so the frontend can build the checkbox UI."""
    return ALL_PERMISSIONS


@router.post("/")
async def create_role(body: RoleCreate, admin: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    name = body.name.strip().lower().replace(" ", "_")
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")

    existing = await db.execute(select(Role).where(Role.name == name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A role with that name already exists")

    invalid = [p for p in body.permissions if p not in ALL_PERMISSIONS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {invalid}")

    role = Role(
        name=name,
        label=body.label.strip() or name,
        description=body.description.strip(),
        is_system=False,
        permissions=json.dumps(body.permissions),
    )
    db.add(role)
    await db.flush()
    await log_audit(db, actor=admin, action="role.created",
                    category="roles", target_type="role", target_id=name,
                    target_label=body.label or name,
                    detail=f"{admin.email} created role '{body.label or name}' with {len(body.permissions)} permission(s)")
    await db.commit()
    await db.refresh(role)
    return _role_out(role)


@router.put("/{role_name}")
async def update_role(
    role_name: str,
    body: RoleUpdate,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Role).where(Role.name == role_name))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if body.label is not None and not role.is_system:
        role.label = body.label.strip() or role.label
    if body.description is not None:
        role.description = body.description.strip()
    old_perms = json.loads(role.permissions or "[]")
    if body.permissions is not None:
        invalid = [p for p in body.permissions if p not in ALL_PERMISSIONS]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unknown permissions: {invalid}")
        # Admin role always keeps all permissions
        if role.name == "admin":
            role.permissions = json.dumps(ALL_PERMISSIONS)
        else:
            role.permissions = json.dumps(body.permissions)

    new_perms = json.loads(role.permissions or "[]")
    added   = [p for p in new_perms if p not in old_perms]
    removed = [p for p in old_perms if p not in new_perms]
    changes = []
    if added:   changes.append(f"+{len(added)} permission(s)")
    if removed: changes.append(f"-{len(removed)} permission(s)")
    if body.label and not role.is_system: changes.append(f"label → {body.label}")
    if body.description is not None:      changes.append("description updated")

    await log_audit(db, actor=admin, action="role.updated",
                    category="roles", target_type="role", target_id=role_name,
                    target_label=role.label,
                    detail=f"{admin.email} updated role '{role.label}': {', '.join(changes) if changes else 'no changes'}",
                    extra={"added_permissions": added, "removed_permissions": removed})
    await db.commit()
    await db.refresh(role)
    return _role_out(role)


@router.delete("/{role_name}")
async def delete_role(
    role_name: str,
    admin: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Role).where(Role.name == role_name))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=403, detail="System roles cannot be deleted")

    # Demote any users currently assigned to this role
    users_result = await db.execute(select(UserRecord).where(UserRecord.role == role_name))
    affected_users = users_result.scalars().all()
    for user in affected_users:
        user.role = "user"

    label = role.label
    await db.delete(role)
    await db.flush()
    await log_audit(db, actor=admin, action="role.deleted",
                    category="roles", target_type="role", target_id=role_name,
                    target_label=label,
                    detail=f"{admin.email} deleted role '{label}'" +
                           (f"; {len(affected_users)} user(s) demoted to 'user'" if affected_users else ""),
                    extra={"affected_user_count": len(affected_users)})
    await db.commit()
    return {"deleted": True}
