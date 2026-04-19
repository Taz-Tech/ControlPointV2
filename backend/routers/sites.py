from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from ..database import get_db
from ..models import Site, Switch, FloorMap, UserRecord, UnifiDevice
from .settings import require_permission

_require_sites_edit = require_permission("action.sites_edit")

router = APIRouter(prefix="/api/sites", tags=["sites"])


class SiteCreate(BaseModel):
    name: str

class SiteUnifiHost(BaseModel):
    unifi_host_id: str | None = None

class SiteController(BaseModel):
    controller_url:  str | None = None
    controller_user: str | None = None
    controller_pass: str | None = None   # empty string = keep existing
    unifi_site_name: str | None = None


def _site_out(site: Site) -> dict:
    return {
        "id":            site.id,
        "name":          site.name,
        "unifi_host_id": site.unifi_host_id,
        "switches": [
            {
                "id": sw.id, "name": sw.name, "ip_address": sw.ip_address,
                "stack_position": sw.stack_position, "unifi_device_id": sw.unifi_device_id,
                "mac_address": sw.mac_address, "model": sw.model,
            }
            for sw in site.switches
        ],
        "maps": [
            {"id": fm.id, "name": fm.name, "filename": fm.filename}
            for fm in site.floor_maps
        ],
        "controller_url":         site.controller_url,
        "controller_user":        site.controller_user,
        "controller_configured":  bool(site.controller_url and site.controller_user and site.controller_pass),
        "unifi_site_name":        site.unifi_site_name,
        "unifi_devices": [
            {
                "id": ud.id, "unifi_id": ud.unifi_id, "name": ud.name,
                "device_type": ud.device_type, "model": ud.model,
                "mac": ud.mac, "ip": ud.ip, "state": ud.state,
                "last_synced": ud.last_synced,
            }
            for ud in site.unifi_devices
        ],
    }


async def _load_site(site_id: int, db: AsyncSession) -> Site:
    result = await db.execute(
        select(Site)
        .where(Site.id == site_id)
        .options(selectinload(Site.switches), selectinload(Site.floor_maps), selectinload(Site.unifi_devices))
    )
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


@router.get("/")
async def list_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Site).options(selectinload(Site.switches), selectinload(Site.floor_maps), selectinload(Site.unifi_devices))
    )
    return [_site_out(s) for s in result.scalars().all()]


@router.post("/")
async def create_site(body: SiteCreate, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Site name is required")
    site = Site(name=name)
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return _site_out(await _load_site(site.id, db))


@router.patch("/{site_id}/controller")
async def set_controller(site_id: int, body: SiteController, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if body.controller_url  is not None: site.controller_url  = body.controller_url  or None
    if body.controller_user is not None: site.controller_user = body.controller_user or None
    if body.controller_pass:             site.controller_pass = body.controller_pass   # only overwrite when non-empty
    if body.unifi_site_name is not None: site.unifi_site_name = body.unifi_site_name or None
    await db.commit()
    return _site_out(await _load_site(site_id, db))


@router.patch("/{site_id}/unifi-host")
async def set_unifi_host(site_id: int, body: SiteUnifiHost, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site.unifi_host_id = body.unifi_host_id or None
    await db.commit()
    return _site_out(await _load_site(site_id, db))


@router.delete("/{site_id}")
async def delete_site(site_id: int, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.delete(site)
    await db.commit()
    return {"deleted": True}


@router.post("/{site_id}/switches/{switch_id}")
async def add_switch_to_site(site_id: int, switch_id: int, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    site = await _load_site(site_id, db)
    sw_result = await db.execute(select(Switch).where(Switch.id == switch_id))
    sw = sw_result.scalar_one_or_none()
    if not sw:
        raise HTTPException(status_code=404, detail="Switch not found")
    if sw not in site.switches:
        site.switches.append(sw)
        await db.commit()
    return _site_out(await _load_site(site_id, db))


@router.delete("/{site_id}/switches/{switch_id}")
async def remove_switch_from_site(site_id: int, switch_id: int, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    site = await _load_site(site_id, db)
    site.switches = [sw for sw in site.switches if sw.id != switch_id]
    await db.commit()
    return _site_out(await _load_site(site_id, db))


@router.post("/{site_id}/maps/{map_id}")
async def add_map_to_site(site_id: int, map_id: int, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    site = await _load_site(site_id, db)
    fm_result = await db.execute(select(FloorMap).where(FloorMap.id == map_id))
    fm = fm_result.scalar_one_or_none()
    if not fm:
        raise HTTPException(status_code=404, detail="Floor map not found")
    if fm not in site.floor_maps:
        site.floor_maps.append(fm)
        await db.commit()
    return _site_out(await _load_site(site_id, db))


@router.delete("/{site_id}/maps/{map_id}")
async def remove_map_from_site(site_id: int, map_id: int, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    site = await _load_site(site_id, db)
    site.floor_maps = [fm for fm in site.floor_maps if fm.id != map_id]
    await db.commit()
    return _site_out(await _load_site(site_id, db))
