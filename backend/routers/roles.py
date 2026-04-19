import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Role, UserRecord, ALL_PERMISSIONS
from .settings import require_admin

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
async def create_role(body: RoleCreate, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
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
    await db.commit()
    await db.refresh(role)
    return _role_out(role)


@router.put("/{role_name}")
async def update_role(
    role_name: str,
    body: RoleUpdate,
    _: UserRecord = Depends(require_admin),
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
    if body.permissions is not None:
        invalid = [p for p in body.permissions if p not in ALL_PERMISSIONS]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unknown permissions: {invalid}")
        # Admin role always keeps all permissions
        if role.name == "admin":
            role.permissions = json.dumps(ALL_PERMISSIONS)
        else:
            role.permissions = json.dumps(body.permissions)

    await db.commit()
    await db.refresh(role)
    return _role_out(role)


@router.delete("/{role_name}")
async def delete_role(
    role_name: str,
    _: UserRecord = Depends(require_admin),
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
    for user in users_result.scalars().all():
        user.role = "user"

    await db.delete(role)
    await db.commit()
    return {"deleted": True}
