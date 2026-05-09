"""
Feature flag management.
Each row in the features table represents one product capability that can be
enabled or disabled per tenant.  Config stores provider credentials or other
feature-specific settings as a JSON blob.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Feature

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

router = APIRouter(prefix="/api/features", tags=["features"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Authentication required")
    return user


def _serialize(f: Feature) -> dict:
    try:
        cfg = json.loads(f.config) if f.config else {}
    except Exception:
        cfg = {}
    return {
        "id":          f.id,
        "key":         f.key,
        "name":        f.name,
        "description": f.description,
        "category":    f.category,
        "enabled":     f.enabled,
        "config":      cfg,
        "updated_at":  f.updated_at,
        "updated_by":  f.updated_by,
    }


@router.get("")
async def list_features(db: AsyncSession = Depends(get_db)):
    """Return all features grouped by category."""
    rows = (await db.execute(select(Feature).order_by(Feature.category, Feature.name))).scalars().all()
    return [_serialize(r) for r in rows]


@router.get("/{key}")
async def get_feature(key: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(Feature).where(Feature.key == key))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Feature '{key}' not found")
    return _serialize(row)


@router.patch("/{key}")
async def update_feature(
    key: str,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Toggle a feature on/off and/or update its config. Admin only."""
    actor = _require_admin(request)
    row = (await db.execute(select(Feature).where(Feature.key == key))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Feature '{key}' not found")

    if "enabled" in body:
        row.enabled = bool(body["enabled"])
    if "config" in body:
        try:
            existing = json.loads(row.config) if row.config else {}
        except Exception:
            existing = {}
        existing.update(body["config"])
        row.config = json.dumps(existing)
    if "name" in body:
        row.name = body["name"]
    if "description" in body:
        row.description = body["description"]

    row.updated_at = _now()
    row.updated_by = actor.get("email") or actor.get("preferred_username") or "admin"
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


@router.put("/{key}/config")
async def replace_feature_config(
    key: str,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Replace the entire config blob for a feature. Admin only."""
    actor = _require_admin(request)
    row = (await db.execute(select(Feature).where(Feature.key == key))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Feature '{key}' not found")
    row.config     = json.dumps(body)
    row.updated_at = _now()
    row.updated_by = actor.get("email") or actor.get("preferred_username") or "admin"
    await db.commit()
    await db.refresh(row)
    return _serialize(row)
