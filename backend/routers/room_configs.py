from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from ..database import get_db
from ..models import ConferenceRoomConfig, SeatMapping

router = APIRouter(prefix="/api/room-configs", tags=["room-configs"])


class RoomConfigBody(BaseModel):
    site_id:         Optional[int] = None
    seat_mapping_id: Optional[int] = None


def _cfg_out(cfg: ConferenceRoomConfig) -> dict:
    seat = cfg.seat_mapping
    return {
        "room_email":      cfg.room_email,
        "site_id":         cfg.site_id,
        "site_name":       cfg.site.name if cfg.site else None,
        "seat_mapping_id": cfg.seat_mapping_id,
        "seat": {
            "id":          seat.id,
            "label":       seat.seat_label,
            "port":        seat.port,
            "x_pct":       seat.x_pct,
            "y_pct":       seat.y_pct,
            "map_id":      seat.floor_map_id,
            "map_name":    seat.floor_map.name if seat.floor_map else None,
            "switch_name": seat.switch.name if seat.switch else None,
            "switch_ip":   seat.switch.ip_address if seat.switch else None,
        } if seat else None,
    }


async def _load_cfg(room_email: str, db: AsyncSession) -> ConferenceRoomConfig:
    result = await db.execute(
        select(ConferenceRoomConfig)
        .where(ConferenceRoomConfig.room_email == room_email)
        .options(
            selectinload(ConferenceRoomConfig.site),
            selectinload(ConferenceRoomConfig.seat_mapping)
                .selectinload(SeatMapping.switch),
            selectinload(ConferenceRoomConfig.seat_mapping)
                .selectinload(SeatMapping.floor_map),
        )
    )
    return result.scalar_one()


@router.get("/")
async def list_room_configs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ConferenceRoomConfig)
        .options(
            selectinload(ConferenceRoomConfig.site),
            selectinload(ConferenceRoomConfig.seat_mapping)
                .selectinload(SeatMapping.switch),
            selectinload(ConferenceRoomConfig.seat_mapping)
                .selectinload(SeatMapping.floor_map),
        )
    )
    return [_cfg_out(c) for c in result.scalars().all()]


@router.put("/{room_email:path}")
async def upsert_room_config(room_email: str, body: RoomConfigBody, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ConferenceRoomConfig).where(ConferenceRoomConfig.room_email == room_email)
    )
    cfg = result.scalar_one_or_none()
    if cfg is None:
        cfg = ConferenceRoomConfig(room_email=room_email)
        db.add(cfg)

    cfg.site_id         = body.site_id
    cfg.seat_mapping_id = body.seat_mapping_id
    await db.commit()
    return _cfg_out(await _load_cfg(room_email, db))


@router.delete("/{room_email:path}")
async def delete_room_config(room_email: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ConferenceRoomConfig).where(ConferenceRoomConfig.room_email == room_email)
    )
    cfg = result.scalar_one_or_none()
    if cfg:
        await db.delete(cfg)
        await db.commit()
    return {"deleted": True}
