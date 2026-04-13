import os
import re
import uuid
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List

from ..database import get_db
from ..models import FloorMap, SeatMapping, Switch

router = APIRouter(prefix="/api/maps", tags=["maps"])

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"}


# ─── Schemas ─────────────────────────────────────────────────────────────────

class RotationUpdate(BaseModel):
    rotation: int  # must be 0 | 90 | 180 | 270


class SeatCreate(BaseModel):
    seat_label: str
    port: str
    x_pct: float
    y_pct: float
    switch_id: Optional[int] = None


class SeatUpdate(BaseModel):
    seat_label: Optional[str] = None
    port: Optional[str] = None
    x_pct: Optional[float] = None
    y_pct: Optional[float] = None
    switch_id: Optional[int] = None


class SeatImportRow(BaseModel):
    seat_label: str
    port: Optional[str] = None
    switch_name: Optional[str] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _seat_out(seat: SeatMapping) -> dict:
    return {
        "id": seat.id,
        "seat_label": seat.seat_label,
        "port": seat.port,
        "x_pct": seat.x_pct,
        "y_pct": seat.y_pct,
        "switch_id": seat.switch_id,
        "switch_name": seat.switch.name if seat.switch else None,
        "switch_ip": seat.switch.ip_address if seat.switch else None,
    }


def _map_out(fm: FloorMap) -> dict:
    return {
        "id": fm.id,
        "name": fm.name,
        "filename": fm.filename,
        "rotation": fm.rotation,
        "seats": [_seat_out(s) for s in fm.seats],
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/")
async def list_maps(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FloorMap).options(selectinload(FloorMap.seats).selectinload(SeatMapping.switch))
    )
    maps = result.scalars().all()
    return [{"id": fm.id, "name": fm.name, "filename": fm.filename, "seat_count": len(fm.seats)} for fm in maps]


@router.post("/upload")
async def upload_map(name: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(UPLOAD_DIR, unique_name)

    async with aiofiles.open(dest_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    fm = FloorMap(name=name, filename=unique_name)
    db.add(fm)
    await db.commit()
    await db.refresh(fm)
    return {"id": fm.id, "name": fm.name, "filename": fm.filename}


@router.get("/{map_id}")
async def get_map(map_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FloorMap)
        .where(FloorMap.id == map_id)
        .options(selectinload(FloorMap.seats).selectinload(SeatMapping.switch))
    )
    fm = result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")
    return _map_out(fm)


@router.get("/{map_id}/image")
async def get_map_image(map_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FloorMap).where(FloorMap.id == map_id))
    fm = result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")
    path = os.path.join(UPLOAD_DIR, fm.filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Image file not found on disk")
    return FileResponse(path)


@router.post("/{map_id}/seats")
async def add_seat(map_id: int, body: SeatCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FloorMap).where(FloorMap.id == map_id))
    fm = result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")
    seat = SeatMapping(floor_map_id=map_id, **body.model_dump())
    db.add(seat)
    await db.commit()
    await db.refresh(seat)
    # reload with switch relation
    result2 = await db.execute(
        select(SeatMapping).where(SeatMapping.id == seat.id).options(selectinload(SeatMapping.switch))
    )
    seat = result2.scalar_one()
    return _seat_out(seat)


@router.put("/{map_id}/seats/{seat_id}")
async def update_seat(map_id: int, seat_id: int, body: SeatUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SeatMapping)
        .where(SeatMapping.id == seat_id, SeatMapping.floor_map_id == map_id)
        .options(selectinload(SeatMapping.switch))
    )
    seat = result.scalar_one_or_none()
    if not seat:
        raise HTTPException(status_code=404, detail="Seat not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(seat, field, val)
    await db.commit()
    await db.refresh(seat)
    result2 = await db.execute(
        select(SeatMapping).where(SeatMapping.id == seat.id).options(selectinload(SeatMapping.switch))
    )
    seat = result2.scalar_one()
    return _seat_out(seat)


@router.delete("/{map_id}/seats/{seat_id}")
async def delete_seat(map_id: int, seat_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SeatMapping).where(SeatMapping.id == seat_id, SeatMapping.floor_map_id == map_id)
    )
    seat = result.scalar_one_or_none()
    if not seat:
        raise HTTPException(status_code=404, detail="Seat not found")
    await db.delete(seat)
    await db.commit()
    return {"deleted": True}


@router.post("/{map_id}/seats/import")
async def import_seats(map_id: int, rows: List[SeatImportRow], db: AsyncSession = Depends(get_db)):
    """Match imported rows against existing seats by seat_label.
    Updates port/switch on matched seats; returns unmatched rows for manual placement."""

    result = await db.execute(
        select(FloorMap)
        .where(FloorMap.id == map_id)
        .options(selectinload(FloorMap.seats).selectinload(SeatMapping.switch))
    )
    fm = result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")

    # Load all switches for name/IP resolution
    sw_result = await db.execute(select(Switch))
    all_switches = sw_result.scalars().all()

    def resolve_switch(switch_name: Optional[str]) -> Optional[int]:
        if not switch_name:
            return None
        parts = [p.strip().lower() for p in re.split(r'\s*-\s*', switch_name)]
        for sw in all_switches:
            sw_name = sw.name.lower()
            sw_ip = sw.ip_address.lower()
            if any(p == sw_name or p == sw_ip or sw_name in p or p in sw_name for p in parts):
                return sw.id
        return None

    # Normalize label for matching: lowercase + strip
    def norm(label: str) -> str:
        return label.strip().lower()

    seat_lookup = {norm(s.seat_label): s for s in fm.seats}

    updated_seats = []
    unmatched = []

    for row in rows:
        existing = seat_lookup.get(norm(row.seat_label))
        if existing is not None:
            if row.port is not None and row.port.strip():
                existing.port = row.port.strip()
            if row.switch_name is not None:
                existing.switch_id = resolve_switch(row.switch_name)
            updated_seats.append(existing)
        else:
            unmatched.append(row.model_dump())

    if updated_seats:
        await db.commit()
        ids = [s.id for s in updated_seats]
        reload = await db.execute(
            select(SeatMapping)
            .where(SeatMapping.id.in_(ids))
            .options(selectinload(SeatMapping.switch))
        )
        updated_seats = reload.scalars().all()

    return {
        "updated": [_seat_out(s) for s in updated_seats],
        "unmatched": unmatched,
    }


@router.put("/{map_id}/rotation")
async def update_map_rotation(map_id: int, body: RotationUpdate, db: AsyncSession = Depends(get_db)):
    if body.rotation not in (0, 90, 180, 270):
        raise HTTPException(status_code=400, detail="Rotation must be 0, 90, 180, or 270")
    result = await db.execute(select(FloorMap).where(FloorMap.id == map_id))
    fm = result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")
    fm.rotation = body.rotation
    await db.commit()
    return {"id": fm.id, "rotation": fm.rotation}


@router.delete("/{map_id}")
async def delete_map(map_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FloorMap).where(FloorMap.id == map_id))
    fm = result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")
    # Remove image file
    path = os.path.join(UPLOAD_DIR, fm.filename)
    if os.path.exists(path):
        os.remove(path)
    await db.delete(fm)
    await db.commit()
    return {"deleted": True}
