import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.environ["SUPABASE_DATABASE_URL"]

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args={"statement_cache_size": 0},
)

AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def create_all():
    """
    Create any tables that don't yet exist in Supabase.
    Safe to run on every startup — SQLAlchemy skips tables that already exist.
    Import all model modules first so Base.metadata is fully populated.
    """
    from . import models  # noqa: F401 — registers all ORM classes with Base.metadata
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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


_DEFAULT_NOTIFICATION_RULES = [
    {
        "name": "Ticket Assigned to You",
        "description": "Fires when a ticket is assigned or reassigned directly to you.",
        "trigger_type": "ticket_assigned",
    },
    {
        "name": "Ticket Assigned to Your Group",
        "description": "Fires when a ticket is routed to a group you belong to.",
        "trigger_type": "ticket_group_assigned",
    },
    {
        "name": "Status Changed on Your Ticket",
        "description": "Fires when the status changes on a ticket you are assigned to.",
        "trigger_type": "ticket_status_changed",
    },
    {
        "name": "New Comment on Your Ticket",
        "description": "Fires when a new external reply is added to your assigned ticket.",
        "trigger_type": "ticket_commented",
    },
    {
        "name": "Priority Changed on Your Ticket",
        "description": "Fires when the priority changes on a ticket you are assigned to.",
        "trigger_type": "ticket_priority_changed",
    },
    {
        "name": "Ticket Resolved or Closed",
        "description": "Fires when a ticket you are assigned to is marked resolved or closed.",
        "trigger_type": "ticket_resolved",
    },
    {
        "name": "Mentioned in a Comment",
        "description": "Fires when someone @mentions you in a ticket comment or internal note.",
        "trigger_type": "ticket_mentioned",
    },
]


async def seed_notification_rules():
    """Insert default system notification rules that don't yet exist."""
    from datetime import datetime, timezone
    from .models import NotificationRule
    from sqlalchemy import select

    now = datetime.now(timezone.utc).isoformat()
    async with AsyncSessionLocal() as session:
        for rule in _DEFAULT_NOTIFICATION_RULES:
            existing = (await session.execute(
                select(NotificationRule).where(NotificationRule.trigger_type == rule["trigger_type"])
                .where(NotificationRule.is_system == True)  # noqa: E712
            )).scalar_one_or_none()
            if existing is None:
                session.add(NotificationRule(
                    name=rule["name"],
                    description=rule["description"],
                    trigger_type=rule["trigger_type"],
                    conditions="{}",
                    enabled=True,
                    is_system=True,
                    created_at=now,
                ))
        await session.commit()


_DEFAULT_FEATURES = [
    {
        "key":         "native_ticketing",
        "name":        "Native Ticketing System",
        "description": "Full built-in ticketing platform — includes tickets, tasks, change management, problem management, project boards, knowledge base, SLA tracking, and customer portal.",
        "category":    "ticketing",
        "enabled":     False,
    },
    {
        "key":         "external_ticketing",
        "name":        "External Ticket Integration",
        "description": "Connect your existing ticketing system (Freshservice, Jira, ServiceNow, or Zendesk) and manage tickets directly from ControlPoint.",
        "category":    "ticketing",
        "enabled":     False,
    },
    {
        "key":         "asset_management",
        "name":        "Asset Management",
        "description": "Track hardware, software, and contracts with lifecycle management.",
        "category":    "it_management",
        "enabled":     True,
    },
    {
        "key":         "network_management",
        "name":        "Network Management",
        "description": "UniFi, switch management, and network topology views.",
        "category":    "it_management",
        "enabled":     True,
    },
    {
        "key":         "device_management",
        "name":        "Device Management",
        "description": "ImmyBot and Intune device search, status, and deployment management.",
        "category":    "it_management",
        "enabled":     True,
    },
]


async def seed_features():
    """Insert default feature flags that don't yet exist. Never overwrites existing rows."""
    from datetime import datetime, timezone
    from .models import Feature
    from sqlalchemy import select

    now = datetime.now(timezone.utc).isoformat()
    async with AsyncSessionLocal() as session:
        for feat in _DEFAULT_FEATURES:
            exists = (await session.execute(
                select(Feature).where(Feature.key == feat["key"])
            )).scalar_one_or_none()
            if not exists:
                session.add(Feature(
                    key=feat["key"],
                    name=feat["name"],
                    description=feat["description"],
                    category=feat["category"],
                    enabled=feat["enabled"],
                    config="{}",
                    updated_at=now,
                    updated_by="system",
                ))
        await session.commit()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
