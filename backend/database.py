from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "sqlite+aiosqlite:///./portal.db"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def create_all():
    async with engine.begin() as conn:
        from . import models  # noqa: F401 — ensure models are registered
        await conn.run_sync(Base.metadata.create_all)
        # Add custom_role_id to user_records for future FK; for now role is still a string
        # (no migration needed — Role table is created fresh by create_all above)
        # Add new columns to user_records if they don't exist yet
        for col, definition in [
            ("first_name", "TEXT NOT NULL DEFAULT ''"),
            ("last_name",  "TEXT NOT NULL DEFAULT ''"),
        ]:
            try:
                await conn.exec_driver_sql(
                    f"ALTER TABLE user_records ADD COLUMN {col} {definition}"
                )
            except Exception:
                pass  # Column already exists
        # Drop legacy 'name' column — the model now computes name as a property
        try:
            await conn.exec_driver_sql("ALTER TABLE user_records DROP COLUMN name")
        except Exception:
            pass
        # Migrate conference_room_configs: add seat_mapping_id, drop free-form pin columns
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE conference_room_configs ADD COLUMN seat_mapping_id INTEGER REFERENCES seat_mappings(id) ON DELETE SET NULL"
            )
        except Exception:
            pass
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE floor_maps ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0"
            )
        except Exception:
            pass
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE zones ADD COLUMN points TEXT"
            )
        except Exception:
            pass
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE zones ADD COLUMN zone_type TEXT NOT NULL DEFAULT ''"
            )
        except Exception:
            pass
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE sites ADD COLUMN unifi_host_id TEXT"
            )
        except Exception:
            pass
        for _col, _def in [
            ("unifi_device_id", "TEXT"),
            ("mac_address",     "TEXT"),
            ("model",           "TEXT"),
        ]:
            try:
                await conn.exec_driver_sql(f"ALTER TABLE switches ADD COLUMN {_col} {_def}")
            except Exception:
                pass
        for _col in ("controller_url", "controller_user", "controller_pass", "unifi_site_name"):
            try:
                await conn.exec_driver_sql(f"ALTER TABLE sites ADD COLUMN {_col} TEXT")
            except Exception:
                pass
        for _col in ("map_id", "x_pct", "y_pct"):
            try:
                await conn.exec_driver_sql(f"ALTER TABLE conference_room_configs DROP COLUMN {_col}")
            except Exception:
                pass  # Column already dropped or doesn't exist
        # Add rc_extension_id to user_records
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE user_records ADD COLUMN rc_extension_id TEXT"
            )
        except Exception:
            pass
        # Add rc_presence_access to user_records
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE user_records ADD COLUMN rc_presence_access BOOLEAN NOT NULL DEFAULT 0"
            )
        except Exception:
            pass
        # Add controller_api_key to unifi_host_configs (replaces user/pass cookie auth)
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE unifi_host_configs ADD COLUMN controller_api_key TEXT"
            )
        except Exception:
            pass
        # Add roles column to global_shortcuts
        try:
            await conn.exec_driver_sql(
                "ALTER TABLE global_shortcuts ADD COLUMN roles TEXT NOT NULL DEFAULT '[]'"
            )
        except Exception:
            pass
        # Migrate agent_ooo: if ooo_date column exists (old schema), drop and recreate the table
        try:
            cols = await conn.exec_driver_sql("PRAGMA table_info(agent_ooo)")
            col_names = [row[1] for row in cols.fetchall()]
            if "ooo_date" in col_names:
                await conn.exec_driver_sql("DROP TABLE agent_ooo")
                from . import models as _m  # noqa — ensure AgentOOO is registered
                await conn.run_sync(Base.metadata.create_all)
        except Exception:
            pass


async def seed_roles():
    """Insert system roles that don't yet exist in the DB."""
    import json
    from .models import Role, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLE_LABELS
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        for name, perms in SYSTEM_ROLE_PERMISSIONS.items():
            result = await session.execute(select(Role).where(Role.name == name))
            existing = result.scalar_one_or_none()
            if existing is None:
                session.add(Role(
                    name=name,
                    label=SYSTEM_ROLE_LABELS.get(name, name),
                    description="",
                    is_system=True,
                    permissions=json.dumps(perms),
                ))
        await session.commit()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
