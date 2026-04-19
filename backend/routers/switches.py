from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import asyncio

from ..database import get_db
from ..models import Switch, SeatMapping, UserRecord
from .settings import require_permission, require_admin

_require_port_reset  = require_permission("action.port_reset")
_require_sites_edit  = require_permission("action.sites_edit")

router = APIRouter(prefix="/api/switches", tags=["switches"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class SwitchCreate(BaseModel):
    name: str
    ip_address: str
    stack_position: int = 1


class PortResetRequest(BaseModel):
    switch_ip: str
    port: str
    username: str
    password: str
    enable_secret: Optional[str] = None


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/")
async def list_switches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Switch).order_by(Switch.stack_position))
    switches = result.scalars().all()
    return [
        {
            "id":              sw.id,
            "name":            sw.name,
            "ip_address":      sw.ip_address,
            "stack_position":  sw.stack_position,
            "unifi_device_id": sw.unifi_device_id,
            "mac_address":     sw.mac_address,
            "model":           sw.model,
        }
        for sw in switches
    ]


@router.post("/")
async def add_switch(body: SwitchCreate, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    sw = Switch(**body.model_dump())
    db.add(sw)
    await db.commit()
    await db.refresh(sw)
    return {"id": sw.id, "name": sw.name, "ip_address": sw.ip_address, "stack_position": sw.stack_position, "unifi_device_id": None, "mac_address": None, "model": None}


@router.delete("/{switch_id}")
async def delete_switch(switch_id: int, _: UserRecord = Depends(_require_sites_edit), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Switch).where(Switch.id == switch_id))
    sw = result.scalar_one_or_none()
    if not sw:
        raise HTTPException(status_code=404, detail="Switch not found")
    await db.delete(sw)
    await db.commit()
    return {"deleted": True}


@router.post("/reset-port")
async def reset_port(body: PortResetRequest, _: UserRecord = Depends(_require_port_reset)):
    """
    Open an SSH session to the switch and execute a port-security reset sequence:
      1. clear port-security sticky interface <port>
      2. shutdown the interface
      3. no shutdown the interface
    Returns the raw command output.
    """
    output_lines = []

    def _do_ssh():
        try:
            from netmiko import ConnectHandler
        except ImportError:
            raise HTTPException(status_code=500, detail="netmiko not installed")

        device = {
            "device_type": "cisco_ios",
            "host": body.switch_ip,
            "username": body.username,
            "password": body.password,
            "secret": body.enable_secret or body.password,
            "timeout": 20,
        }

        with ConnectHandler(**device) as net_connect:
            net_connect.enable()
            output = net_connect.send_config_set(
                [
                    f"interface {body.port}",
                    "shutdown",
                ]
            )
            output_lines.append(output)

            clear_out = net_connect.send_command(
                f"clear port-security sticky interface {body.port}",
                expect_string=r"#",
            )
            output_lines.append(clear_out)

            output2 = net_connect.send_config_set(
                [
                    f"interface {body.port}",
                    "no shutdown",
                ]
            )
            output_lines.append(output2)

        return output_lines

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _do_ssh)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    return {"success": True, "output": "\n".join(result)}
