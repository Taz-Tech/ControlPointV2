import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List

from ..database import get_db
from ..models import Zone, SeatAssignment, SeatMapping

router = APIRouter(prefix="/api/zones", tags=["zones"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ZoneCreate(BaseModel):
    name: str
    team_name: str = ""
    zone_type: str = ""
    color: str = "#3b82f6"
    floor_map_id: int
    x1_pct: float
    y1_pct: float
    x2_pct: float
    y2_pct: float
    points: Optional[List] = None   # [{x, y}, ...] polygon vertices


class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    team_name: Optional[str] = None
    zone_type: Optional[str] = None
    color: Optional[str] = None
    x1_pct: Optional[float] = None
    y1_pct: Optional[float] = None
    x2_pct: Optional[float] = None
    y2_pct: Optional[float] = None
    points: Optional[List] = None   # [{x, y}, ...] polygon vertices


class AssignmentUpsert(BaseModel):
    user_id: Optional[str] = None
    user_display_name: Optional[str] = None
    user_email: Optional[str] = None


# ── Serialisers ───────────────────────────────────────────────────────────────

def _zone_out(zone: Zone) -> dict:
    return {
        "id":           zone.id,
        "name":         zone.name,
        "team_name":    zone.team_name,
        "zone_type":    zone.zone_type or "",
        "color":        zone.color,
        "floor_map_id": zone.floor_map_id,
        "x1_pct":       zone.x1_pct,
        "y1_pct":       zone.y1_pct,
        "x2_pct":       zone.x2_pct,
        "y2_pct":       zone.y2_pct,
        "points":       json.loads(zone.points) if zone.points else None,
    }


def _assignment_out(a: SeatAssignment) -> dict:
    return {
        "id":                a.id,
        "seat_id":           a.seat_id,
        "user_id":           a.user_id,
        "user_display_name": a.user_display_name,
        "user_email":        a.user_email,
        "assigned_at":       a.assigned_at,
    }


# ── Zone CRUD ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_zones(floor_map_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Zone).where(Zone.floor_map_id == floor_map_id)
    )
    return [_zone_out(z) for z in result.scalars().all()]


@router.post("/")
async def create_zone(body: ZoneCreate, db: AsyncSession = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Zone name is required")
    zone = Zone(
        name=body.name.strip(),
        team_name=body.team_name.strip(),
        zone_type=body.zone_type.strip(),
        color=body.color,
        floor_map_id=body.floor_map_id,
        x1_pct=body.x1_pct,
        y1_pct=body.y1_pct,
        x2_pct=body.x2_pct,
        y2_pct=body.y2_pct,
        points=json.dumps(body.points) if body.points else None,
    )
    db.add(zone)
    await db.commit()
    await db.refresh(zone)
    return _zone_out(zone)


@router.put("/{zone_id}")
async def update_zone(zone_id: int, body: ZoneUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Zone).where(Zone.id == zone_id))
    zone = result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if body.name is not None:
        zone.name = body.name.strip()
    if body.team_name is not None:
        zone.team_name = body.team_name.strip()
    if body.zone_type is not None:
        zone.zone_type = body.zone_type.strip()
    if body.color is not None:
        zone.color = body.color
    if body.x1_pct is not None:
        zone.x1_pct = body.x1_pct
    if body.y1_pct is not None:
        zone.y1_pct = body.y1_pct
    if body.x2_pct is not None:
        zone.x2_pct = body.x2_pct
    if body.y2_pct is not None:
        zone.y2_pct = body.y2_pct
    if body.points is not None:
        zone.points = json.dumps(body.points)
    await db.commit()
    await db.refresh(zone)
    return _zone_out(zone)


@router.delete("/{zone_id}")
async def delete_zone(zone_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Zone).where(Zone.id == zone_id))
    zone = result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    await db.delete(zone)
    await db.commit()
    return {"deleted": True}


# ── Seat Assignments ──────────────────────────────────────────────────────────

@router.get("/assignments")
async def list_assignments(floor_map_id: int, db: AsyncSession = Depends(get_db)):
    """Return all seat assignments for every seat on the given floor map."""
    result = await db.execute(
        select(SeatAssignment)
        .join(SeatMapping, SeatAssignment.seat_id == SeatMapping.id)
        .where(SeatMapping.floor_map_id == floor_map_id)
    )
    return [_assignment_out(a) for a in result.scalars().all()]


@router.put("/assignments/{seat_id}")
async def upsert_assignment(
    seat_id: int,
    body: AssignmentUpsert,
    db: AsyncSession = Depends(get_db),
):
    """Assign (or re-assign) an employee to a seat. Creates or replaces the record."""
    # Verify seat exists
    seat_result = await db.execute(select(SeatMapping).where(SeatMapping.id == seat_id))
    if not seat_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Seat not found")

    result = await db.execute(select(SeatAssignment).where(SeatAssignment.seat_id == seat_id))
    assignment = result.scalar_one_or_none()

    now = datetime.now(timezone.utc).isoformat()
    if assignment:
        assignment.user_id           = body.user_id
        assignment.user_display_name = body.user_display_name
        assignment.user_email        = body.user_email
        assignment.assigned_at       = now
    else:
        assignment = SeatAssignment(
            seat_id=seat_id,
            user_id=body.user_id,
            user_display_name=body.user_display_name,
            user_email=body.user_email,
            assigned_at=now,
        )
        db.add(assignment)

    await db.commit()
    await db.refresh(assignment)
    return _assignment_out(assignment)


@router.delete("/assignments/{seat_id}")
async def delete_assignment(seat_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SeatAssignment).where(SeatAssignment.seat_id == seat_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()
    return {"deleted": True}
