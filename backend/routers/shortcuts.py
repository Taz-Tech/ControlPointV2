import json
import os
import uuid
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from ..database import get_db
from ..models import GlobalShortcut, UserRecord
from .settings import require_admin

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "shortcut_icons")
os.makedirs(ICON_DIR, exist_ok=True)

router = APIRouter(prefix="/api/shortcuts", tags=["shortcuts"])

VALID_ROLES = {"admin", "user", "service_desk", "applications_team", "net_inf_team"}


class ShortcutBody(BaseModel):
    name: str
    url: str
    icon: str = "🔗"
    description: str = ""
    order_index: int = 0
    roles: list[str] = []   # empty = visible to all users


def _parse_roles(raw: str | None) -> list[str]:
    try:
        return json.loads(raw or "[]")
    except Exception:
        return []


def _shortcut_dict(r: GlobalShortcut) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "url": r.url,
        "icon": r.icon,
        "description": r.description,
        "order_index": r.order_index,
        "roles": _parse_roles(r.roles),
    }


async def _get_user_role(request: Request, db: AsyncSession) -> str:
    user = getattr(request.state, "user", None)
    if not user or not user.get("id"):
        return "user"
    result = await db.execute(select(UserRecord).where(UserRecord.id == user["id"]))
    record = result.scalar_one_or_none()
    return record.role if record else "user"


@router.get("")
async def list_shortcuts(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GlobalShortcut).order_by(GlobalShortcut.order_index, GlobalShortcut.id))
    rows = result.scalars().all()

    user_role = await _get_user_role(request, db)

    shortcuts = []
    for r in rows:
        roles = _parse_roles(r.roles)
        # Admins see everything; empty roles list = visible to all; otherwise check membership
        if not roles or user_role == "admin" or user_role in roles:
            shortcuts.append(_shortcut_dict(r))
    return shortcuts


@router.post("")
async def create_shortcut(body: ShortcutBody, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    data = body.model_dump()
    roles = data.pop("roles", [])
    shortcut = GlobalShortcut(**data, roles=json.dumps(roles))
    db.add(shortcut)
    await db.commit()
    await db.refresh(shortcut)
    return _shortcut_dict(shortcut)


@router.put("/{shortcut_id}")
async def update_shortcut(shortcut_id: int, body: ShortcutBody, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GlobalShortcut).where(GlobalShortcut.id == shortcut_id))
    shortcut = result.scalar_one_or_none()
    if not shortcut:
        raise HTTPException(status_code=404, detail="Shortcut not found")
    data = body.model_dump()
    roles = data.pop("roles", [])
    for k, v in data.items():
        setattr(shortcut, k, v)
    shortcut.roles = json.dumps(roles)
    await db.commit()
    return _shortcut_dict(shortcut)


@router.delete("/{shortcut_id}")
async def delete_shortcut(shortcut_id: int, _: UserRecord = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GlobalShortcut).where(GlobalShortcut.id == shortcut_id))
    shortcut = result.scalar_one_or_none()
    if not shortcut:
        raise HTTPException(status_code=404, detail="Shortcut not found")
    await db.delete(shortcut)
    await db.commit()
    return {"ok": True}


@router.post("/{shortcut_id}/icon")
async def upload_shortcut_icon(
    shortcut_id: int,
    file: UploadFile = File(...),
    _: UserRecord = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(GlobalShortcut).where(GlobalShortcut.id == shortcut_id))
    shortcut = result.scalar_one_or_none()
    if not shortcut:
        raise HTTPException(status_code=404, detail="Shortcut not found")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    filename = f"{shortcut_id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(ICON_DIR, filename)
    with open(dest, "wb") as f:
        f.write(await file.read())

    shortcut.icon = f"/uploads/shortcut_icons/{filename}"
    await db.commit()
    return {"icon": shortcut.icon}
