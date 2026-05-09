from sqlalchemy import Column, Integer, BigInteger, String, Float, Boolean, ForeignKey, Table, Text, Index, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


# ── Permissions catalogue ─────────────────────────────────────────────────────
#
# Each string is a capability key.  Grouped by prefix:
#   nav.*        → which sidebar pages are visible
#   action.*     → sensitive operations
#   settings.*   → which Settings tabs are accessible
#
ALL_PERMISSIONS = [
    # Navigation
    "nav.dashboard",
    "nav.users",
    "nav.devices",
    "nav.conference_rooms",
    "nav.locations",
    "nav.network",
    "nav.mailboxes",
    "nav.deployment",
    "nav.ringcentral",
    # Actions
    "action.port_reset",
    "action.sites_edit",
    # Settings tabs
    "settings.quick_links",
    "settings.users",
    "settings.sites",
    "settings.conference_rooms",
    "settings.integrations",
    "settings.roles",
]

SYSTEM_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": list(ALL_PERMISSIONS),
    "net_inf_team": [
        "nav.dashboard", "nav.users", "nav.devices",
        "nav.conference_rooms", "nav.locations", "nav.network", "nav.ringcentral",
        "action.port_reset", "action.sites_edit",
        "settings.sites",
    ],
    "service_desk": [
        "nav.dashboard", "nav.users", "nav.devices",
        "nav.conference_rooms", "nav.locations", "nav.network",
        "nav.mailboxes", "nav.deployment",
    ],
    "applications_team": [
        "nav.dashboard", "nav.users", "nav.devices",
        "nav.conference_rooms", "nav.locations",
        "nav.mailboxes", "nav.deployment",
    ],
    "network_viewer": [
        "nav.dashboard", "nav.network",
    ],
    "user": [
        "nav.dashboard", "nav.users",
        "nav.conference_rooms", "nav.locations",
    ],
}

SYSTEM_ROLE_LABELS: dict[str, str] = {
    "admin":            "Admin",
    "net_inf_team":     "Net / INF Team",
    "service_desk":     "Service Desk",
    "applications_team": "Applications Team",
    "network_viewer":   "Network Viewer",
    "user":             "User",
}


class Role(Base):
    """Stores both built-in system roles and admin-created custom roles."""
    __tablename__ = "roles"

    name        = Column(String, primary_key=True)           # e.g. "admin", "custom_helpdesk"
    label       = Column(String, nullable=False)             # Display name shown in UI
    description = Column(String, nullable=False, default="")
    is_system   = Column(Boolean, nullable=False, default=False)  # True = cannot be deleted
    permissions = Column(Text,    nullable=False, default="[]")   # JSON array of permission keys


class DirectoryUser(Base):
    """
    Unified user directory — one row per person, linking M365 + Workday + Okta.
    Email (normalized lowercase) is the deduplication key across all sources.
    """
    __tablename__ = "directory_users"

    id    = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, unique=True, index=True)

    # ── Resolved best-available identity ──────────────────────────────────────
    display_name = Column(String,  nullable=True)
    first_name   = Column(String,  nullable=True)
    last_name    = Column(String,  nullable=True)
    job_title    = Column(String,  nullable=True)
    department   = Column(String,  nullable=True)
    company      = Column(String,  nullable=True)
    employee_id  = Column(String,  nullable=True, index=True)

    # ── Microsoft 365 / Azure AD ──────────────────────────────────────────────
    m365_id              = Column(String,  nullable=True, index=True)   # Azure AD OID
    m365_upn             = Column(String,  nullable=True)
    m365_account_enabled = Column(Boolean, nullable=True)
    m365_office_location = Column(String,  nullable=True)
    m365_usage_location  = Column(String,  nullable=True)
    m365_mobile_phone    = Column(String,  nullable=True)
    m365_business_phones = Column(Text,    nullable=True)   # JSON array
    m365_employee_type   = Column(String,  nullable=True)
    m365_city            = Column(String,  nullable=True)
    m365_state           = Column(String,  nullable=True)
    m365_country         = Column(String,  nullable=True)
    m365_licenses        = Column(Text,    nullable=True)   # JSON array of SKU names
    m365_synced_at       = Column(String,  nullable=True)

    # ── Workday ───────────────────────────────────────────────────────────────
    workday_id            = Column(String, nullable=True)
    workday_worker_type   = Column(String, nullable=True)   # Employee, Contractor, etc.
    workday_status        = Column(String, nullable=True)   # Active, Terminated, Leave, etc.
    workday_hire_date     = Column(String, nullable=True)
    workday_location      = Column(String, nullable=True)
    workday_cost_center   = Column(String, nullable=True)
    workday_manager_email = Column(String, nullable=True)
    workday_synced_at     = Column(String, nullable=True)

    # ── Okta ──────────────────────────────────────────────────────────────────
    okta_id               = Column(String,  nullable=True)
    okta_status           = Column(String,  nullable=True)   # ACTIVE, SUSPENDED, DEPROVISIONED
    okta_login            = Column(String,  nullable=True)
    okta_last_login       = Column(String,  nullable=True)
    okta_password_changed = Column(String,  nullable=True)
    okta_mfa_enrolled     = Column(Boolean, nullable=True)
    okta_synced_at        = Column(String,  nullable=True)

    last_updated = Column(String, nullable=True)


class DeviceRecord(Base):
    """
    Unified device inventory — one row per endpoint, linking ImmyBot + Intune + Aurora.
    Normalized hostname is the deduplication key across all three sources.
    """
    __tablename__ = "device_records"

    id              = Column(Integer, primary_key=True, index=True)
    normalized_name = Column(String, nullable=False, unique=True, index=True)

    # ── Resolved best-available identity ──────────────────────────────────────
    name             = Column(String,  nullable=True)
    serial_number    = Column(String,  nullable=True, index=True)
    manufacturer     = Column(String,  nullable=True)
    model            = Column(String,  nullable=True)
    operating_system = Column(String,  nullable=True)
    primary_user_email = Column(String, nullable=True, index=True)
    primary_user_name  = Column(String, nullable=True)

    # ── ImmyBot ───────────────────────────────────────────────────────────────
    immy_id         = Column(Integer, nullable=True)
    immy_is_online  = Column(Boolean, nullable=True)
    immy_last_seen  = Column(String,  nullable=True)
    immy_last_boot  = Column(String,  nullable=True)
    immy_tenant     = Column(String,  nullable=True)
    immy_url        = Column(String,  nullable=True)
    immy_ip         = Column(String,  nullable=True)
    immy_mac        = Column(String,  nullable=True)
    immy_synced_at  = Column(String,  nullable=True)

    # ── Intune ────────────────────────────────────────────────────────────────
    intune_id          = Column(String,  nullable=True)
    intune_upn         = Column(String,  nullable=True)
    intune_os_version  = Column(String,  nullable=True)
    intune_compliance  = Column(String,  nullable=True)
    intune_mgmt_state  = Column(String,  nullable=True)
    intune_enrolled_at = Column(String,  nullable=True)
    intune_last_sync   = Column(String,  nullable=True)
    intune_encrypted   = Column(Boolean, nullable=True)
    intune_owner_type  = Column(String,  nullable=True)
    intune_synced_at   = Column(String,  nullable=True)

    # ── Aurora / Cylance ──────────────────────────────────────────────────────
    aurora_id          = Column(String,  nullable=True)
    aurora_state       = Column(String,  nullable=True)
    aurora_agent_ver   = Column(String,  nullable=True)
    aurora_policy      = Column(String,  nullable=True)
    aurora_ips         = Column(Text,    nullable=True)   # JSON array
    aurora_macs        = Column(Text,    nullable=True)   # JSON array
    aurora_registered  = Column(String,  nullable=True)
    aurora_offline     = Column(String,  nullable=True)
    aurora_dlcm        = Column(String,  nullable=True)
    aurora_synced_at   = Column(String,  nullable=True)

    last_updated = Column(String, nullable=True)


class ImmybotDeviceCache(Base):
    """
    Persists ImmyBot devices that are invisible to unfiltered pagination
    (e.g. onboardingStatus=2) so the filter cache survives server restarts.
    Also stores the lastProviderAgentEventDateUtc so we can skip writes when
    nothing has changed.
    """
    __tablename__ = "immybot_device_cache"

    immybot_id      = Column(Integer,  primary_key=True)          # ImmyBot's own device ID
    normalized_name = Column(String,   nullable=False, unique=True, index=True)
    shaped_json     = Column(String,   nullable=False)            # JSON of shaped device dict
    last_event_at   = Column(String,   nullable=True)             # lastProviderAgentEventDateUtc
    cached_at       = Column(String,   nullable=False)            # ISO datetime we last wrote


class AgentOOO(Base):
    """Tracks an agent's scheduled Out of Office window."""
    __tablename__ = "agent_ooo"

    user_id        = Column(String, primary_key=True)   # Azure AD OID
    agent_id       = Column(Integer, nullable=False)    # Freshservice agent ID
    ooo_start      = Column(String, nullable=True)      # ISO datetime — start of OOO window
    ooo_end        = Column(String, nullable=True)      # ISO datetime — end of OOO window
    was_occasional = Column(String, nullable=False, default='false')  # original occasional value before OOO
    set_at         = Column(String, nullable=False)     # ISO datetime when last updated



# ── Site association tables ───────────────────────────────────────────────────

site_switches = Table(
    'site_switches', Base.metadata,
    Column('site_id',   Integer, ForeignKey('sites.id',    ondelete='CASCADE'), primary_key=True),
    Column('switch_id', Integer, ForeignKey('switches.id', ondelete='CASCADE'), primary_key=True),
)

site_maps = Table(
    'site_maps', Base.metadata,
    Column('site_id', Integer, ForeignKey('sites.id',      ondelete='CASCADE'), primary_key=True),
    Column('map_id',  Integer, ForeignKey('floor_maps.id', ondelete='CASCADE'), primary_key=True),
)


class Site(Base):
    __tablename__ = 'sites'

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String,  nullable=False, unique=True)
    customer_id      = Column(Integer, ForeignKey('ticket_customers.id', ondelete='SET NULL'), nullable=True, index=True)
    unifi_host_id    = Column(String,  nullable=True)
    controller_url   = Column(String,  nullable=True)   # local UniFi controller, e.g. https://192.168.1.1:8443
    controller_user  = Column(String,  nullable=True)
    controller_pass  = Column(String,  nullable=True)
    unifi_site_name  = Column(String,  nullable=True)   # site ID within the controller, e.g. "default"

    switches      = relationship('Switch',      secondary=site_switches)
    floor_maps    = relationship('FloorMap',    secondary=site_maps)
    unifi_devices = relationship('UnifiDevice', back_populates='site', cascade='all, delete-orphan')


class UnifiHostConfig(Base):
    """Per-host local UniFi Network Application credentials, configured from the Integrations page."""
    __tablename__ = "unifi_host_configs"

    host_id            = Column(String, primary_key=True)   # UniFi cloud host UUID
    host_name          = Column(String, nullable=False, default='')
    controller_url     = Column(String, nullable=True)      # e.g. https://192.168.1.1
    controller_api_key = Column(String, nullable=True)      # X-API-KEY for local Integration API
    unifi_site_name    = Column(String, nullable=True)      # site ID within the controller


class UnifiDevice(Base):
    """Device inventory synced from the UniFi Site Manager API (APs, gateways, etc.)."""
    __tablename__ = "unifi_devices"

    id          = Column(Integer, primary_key=True, index=True)
    unifi_id    = Column(String,  nullable=False)
    site_id     = Column(Integer, ForeignKey('sites.id', ondelete='CASCADE'), nullable=False)
    name        = Column(String,  nullable=False, default='')
    device_type = Column(String,  nullable=False, default='')   # "switch", "ap", "gateway", …
    model       = Column(String,  nullable=True)
    mac         = Column(String,  nullable=True)
    ip          = Column(String,  nullable=True)
    state       = Column(String,  nullable=True)                # "online" / "offline"
    last_synced = Column(String,  nullable=False)               # ISO datetime

    site = relationship('Site', back_populates='unifi_devices')


class Switch(Base):
    __tablename__ = "switches"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String,  nullable=False)
    ip_address      = Column(String,  nullable=False)
    stack_position  = Column(Integer, default=1)
    unifi_device_id = Column(String,  nullable=True)   # set when synced from UniFi
    mac_address     = Column(String,  nullable=True)
    model           = Column(String,  nullable=True)

    seat_mappings = relationship("SeatMapping", back_populates="switch", cascade="all, delete-orphan")


class FloorMap(Base):
    __tablename__ = "floor_maps"

    id       = Column(Integer, primary_key=True, index=True)
    name     = Column(String, nullable=False)
    filename = Column(String, nullable=False)  # saved file path relative to uploads dir
    rotation = Column(Integer, nullable=False, default=0)  # 0 | 90 | 180 | 270

    seats         = relationship("SeatMapping",   back_populates="floor_map", cascade="all, delete-orphan")
    zones         = relationship("Zone",          back_populates="floor_map", cascade="all, delete-orphan")
    ap_placements = relationship("APPlacement",   back_populates="floor_map", cascade="all, delete-orphan")


class UserRecord(Base):
    __tablename__ = "user_records"

    id               = Column(String, primary_key=True)   # Azure AD OID
    first_name       = Column(String, default="")
    last_name        = Column(String, default="")
    email            = Column(String, nullable=False, index=True)
    role             = Column(String, default="user")    # 'admin' | 'user'
    last_seen        = Column(String, nullable=True)      # ISO datetime string
    rc_extension_id  = Column(String,  nullable=True)              # RingCentral extension ID
    rc_presence_access = Column(Boolean, nullable=False, default=False)  # Can view RC Presence page
    password_hash    = Column(String,  nullable=True)    # SHA-256 hex; null = password login disabled

    @property
    def name(self):
        full = f"{self.first_name} {self.last_name}".strip()
        return full or self.email


class GlobalShortcut(Base):
    __tablename__ = "global_shortcuts"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    url         = Column(String, nullable=False)
    icon        = Column(String, default="🔗")
    description = Column(String, default="")
    order_index = Column(Integer, default=0)
    roles       = Column(String, default="[]")   # JSON list of role strings; empty = all users


class UserBookmark(Base):
    __tablename__ = "user_bookmarks"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(String, nullable=False, index=True)   # Azure AD OID from JWT
    name        = Column(String, nullable=False)
    url         = Column(String, nullable=False)
    icon        = Column(String, default="🔖")
    description = Column(String, default="")
    order_index = Column(Integer, default=0)


class ConferenceRoomConfig(Base):
    __tablename__ = 'conference_room_configs'

    id              = Column(Integer, primary_key=True, index=True)
    room_email      = Column(String, nullable=False, unique=True)
    site_id         = Column(Integer, ForeignKey('sites.id',         ondelete='SET NULL'), nullable=True)
    seat_mapping_id = Column(Integer, ForeignKey('seat_mappings.id', ondelete='SET NULL'), nullable=True)

    site         = relationship('Site')
    seat_mapping = relationship('SeatMapping')


class SeatMapping(Base):
    __tablename__ = "seat_mappings"

    id = Column(Integer, primary_key=True, index=True)
    seat_label = Column(String, nullable=False)
    port = Column(String, nullable=False)          # e.g. "GigabitEthernet1/0/5"
    x_pct = Column(Float, nullable=False)          # 0-100 % of image width
    y_pct = Column(Float, nullable=False)          # 0-100 % of image height

    switch_id = Column(Integer, ForeignKey("switches.id", ondelete="SET NULL"), nullable=True)
    floor_map_id = Column(Integer, ForeignKey("floor_maps.id", ondelete="CASCADE"), nullable=False)

    switch = relationship("Switch", back_populates="seat_mappings")
    floor_map = relationship("FloorMap", back_populates="seats")
    assignment = relationship("SeatAssignment", back_populates="seat", uselist=False, cascade="all, delete-orphan")


class Zone(Base):
    """A named, colored bounding-box overlay on a floor map for team/area management."""
    __tablename__ = "zones"

    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String, nullable=False)
    team_name    = Column(String, nullable=False, default="")
    zone_type    = Column(String, nullable=False, default="")   # e.g. "Conference Room", "Huddle Room"
    color        = Column(String, nullable=False, default="#3b82f6")   # hex color
    floor_map_id = Column(Integer, ForeignKey("floor_maps.id", ondelete="CASCADE"), nullable=False)
    x1_pct       = Column(Float, nullable=False)   # top-left corner, 0-100 % of image
    y1_pct       = Column(Float, nullable=False)
    x2_pct       = Column(Float, nullable=False)   # bottom-right corner
    y2_pct       = Column(Float, nullable=False)
    points       = Column(Text, nullable=True)      # JSON array of [{x, y}] polygon vertices

    floor_map = relationship("FloorMap", back_populates="zones")


class SeatAssignment(Base):
    """Assigns an employee to a specific seat on a floor map."""
    __tablename__ = "seat_assignments"

    id                 = Column(Integer, primary_key=True, index=True)
    seat_id            = Column(Integer, ForeignKey("seat_mappings.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id            = Column(String, nullable=True)   # Azure AD OID (optional)
    user_display_name  = Column(String, nullable=True)
    user_email         = Column(String, nullable=True)
    assigned_at        = Column(String, nullable=False)  # ISO datetime string

    seat = relationship("SeatMapping", back_populates="assignment")


class APPlacement(Base):
    """Tracks the physical location of a WiFi access point on a floor map."""
    __tablename__ = "ap_placements"

    id              = Column(Integer, primary_key=True, index=True)
    floor_map_id    = Column(Integer, ForeignKey("floor_maps.id",    ondelete="CASCADE"),  nullable=False)
    unifi_device_id = Column(Integer, ForeignKey("unifi_devices.id", ondelete="SET NULL"), nullable=True)
    name            = Column(String, nullable=False, default="")
    x_pct           = Column(Float, nullable=False)
    y_pct           = Column(Float, nullable=False)

    floor_map    = relationship("FloorMap",    back_populates="ap_placements")
    unifi_device = relationship("UnifiDevice")


class RCPresenceLog(Base):
    """Records every presence status change for RC presence reporting."""
    __tablename__ = "rc_presence_log"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(String, nullable=False, index=True)
    user_name       = Column(String, nullable=False)
    extension_id    = Column(String, nullable=False)
    status          = Column(String, nullable=False)
    dnd_status      = Column(String, nullable=True)
    user_status     = Column(String, nullable=True)
    changed_by_id   = Column(String, nullable=True)
    changed_by_name = Column(String, nullable=True)
    source          = Column(String, nullable=False, default="manual")
    timestamp       = Column(String, nullable=False, index=True)


# ── Ticketing System ──────────────────────────────────────────────────────────

class TicketCustomer(Base):
    """Client company / MSP customer workspace."""
    __tablename__ = "ticket_customers"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    name            = Column(String,  nullable=False)
    slug            = Column(String,  nullable=False, unique=True, index=True)
    domain          = Column(String,  nullable=True)   # e.g. "acme.com" for auto-association
    tier            = Column(String,  nullable=False, default="standard")  # standard | premium | enterprise
    sla_response_hr = Column(Integer, nullable=False, default=4)
    sla_resolve_hr  = Column(Integer, nullable=False, default=24)
    portal_enabled  = Column(Boolean, nullable=False, default=True)
    notes           = Column(Text,    nullable=True)
    created_at      = Column(String,  nullable=False)


class PortalUser(Base):
    """Client-facing portal user (not IT staff)."""
    __tablename__ = "portal_users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    customer_id   = Column(Integer, ForeignKey("ticket_customers.id", ondelete="CASCADE"), nullable=False, index=True)
    email         = Column(String,  nullable=False, unique=True, index=True)
    first_name    = Column(String,  nullable=False, default="")
    last_name     = Column(String,  nullable=False, default="")
    password_hash = Column(String,  nullable=True)
    is_active     = Column(Boolean, nullable=False, default=True)
    is_admin      = Column(Boolean, nullable=False, default=False)  # customer admin
    created_at    = Column(String,  nullable=False)
    last_login    = Column(String,  nullable=True)
    invite_token  = Column(String,  nullable=True, index=True)


class TicketGroup(Base):
    """Internal team/group for ticket routing."""
    __tablename__ = "ticket_groups"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String,  nullable=False)
    description = Column(String,  nullable=False, default="")
    color       = Column(String,  nullable=False, default="#3b82f6")
    created_at  = Column(String,  nullable=False)


class Ticket(Base):
    """Core ticket record."""
    __tablename__ = "tickets"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    number           = Column(String,  nullable=False, unique=True, index=True)  # INC-00001
    type             = Column(String,  nullable=False)   # incident | service_request | task | change | project_task
    status           = Column(String,  nullable=False, default="open")  # open | assigned | in_progress | scheduled | waiting_on_customer | waiting_on_third_party | pending | escalated | resolved | closed | canceled
    priority         = Column(String,  nullable=False, default="medium")  # low | medium | high | critical
    urgency          = Column(String,  nullable=True)   # low | medium | high
    impact           = Column(String,  nullable=True)   # low | medium | high
    title            = Column(String,  nullable=False)
    description      = Column(Text,    nullable=True)
    customer_id      = Column(Integer, ForeignKey("ticket_customers.id", ondelete="SET NULL"), nullable=True, index=True)
    # Requester — one of portal user or staff; free-text fields for external/manual entry
    requester_portal = Column(Integer, ForeignKey("portal_users.id",    ondelete="SET NULL"), nullable=True)
    requester_staff  = Column(String,  ForeignKey("user_records.id",    ondelete="SET NULL"), nullable=True)
    requester_name   = Column(String,  nullable=True)
    requester_email  = Column(String,  nullable=True)
    requester_phone  = Column(String,  nullable=True)
    desk_location    = Column(String,  nullable=True)
    # Assignment
    assigned_to      = Column(String,  ForeignKey("user_records.id",  ondelete="SET NULL"), nullable=True, index=True)
    assigned_team    = Column(String,  nullable=True)
    group_id         = Column(Integer, ForeignKey("ticket_groups.id", ondelete="SET NULL"), nullable=True)
    # Categorisation
    category         = Column(String,  nullable=True)   # Data | Hardware | Software | Network | Other | Employee Status
    # Hierarchy
    project_id       = Column(Integer, ForeignKey("ticket_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    parent_ticket_id = Column(Integer, ForeignKey("tickets.id",         ondelete="SET NULL"), nullable=True)
    problem_id       = Column(Integer, ForeignKey("tickets.id",         ondelete="SET NULL"), nullable=True)  # links to a problem ticket
    # SLA
    sla_response_due = Column(String,  nullable=True)
    sla_resolve_due  = Column(String,  nullable=True)
    sla_breached     = Column(Boolean, nullable=False, default=False)
    first_response_at= Column(String,  nullable=True)
    # Dates
    due_date         = Column(String,  nullable=True)
    planned_start    = Column(String,  nullable=True)
    planned_end      = Column(String,  nullable=True)
    planned_effort   = Column(Float,   nullable=True)   # hours
    resolved_at      = Column(String,  nullable=True)
    closed_at        = Column(String,  nullable=True)
    created_at       = Column(String,  nullable=False, index=True)
    updated_at       = Column(String,  nullable=False)
    # Metadata
    tags             = Column(String,  nullable=False, default="[]")   # JSON list
    source           = Column(String,  nullable=False, default="portal") # portal | email | phone | chat | walk-in
    kb_article_id    = Column(Integer, ForeignKey("kb_articles.id", ondelete="SET NULL"), nullable=True)


class TicketComment(Base):
    """Comment or internal note on a ticket."""
    __tablename__ = "ticket_comments"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id        = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    body             = Column(Text,    nullable=False)
    is_internal      = Column(Boolean, nullable=False, default=False)  # True = staff-only note
    author_staff_id  = Column(String,  ForeignKey("user_records.id",  ondelete="SET NULL"), nullable=True)
    author_portal_id = Column(Integer, ForeignKey("portal_users.id",  ondelete="SET NULL"), nullable=True)
    created_at       = Column(String,  nullable=False)
    updated_at       = Column(String,  nullable=True)


class TicketActivity(Base):
    """Audit log entry for a ticket field change."""
    __tablename__ = "ticket_activities"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id       = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    changed_by      = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    changed_by_name = Column(String,  nullable=False, default="")
    field           = Column(String,  nullable=False)
    old_value       = Column(String,  nullable=True)
    new_value       = Column(String,  nullable=True)
    changed_at      = Column(String,  nullable=False)


class TicketAttachment(Base):
    """File attachment on a ticket (or on a specific comment when comment_id is set)."""
    __tablename__ = "ticket_attachments"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id     = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    comment_id    = Column(Integer, ForeignKey("ticket_comments.id", ondelete="CASCADE"), nullable=True, index=True)
    filename      = Column(String,  nullable=False)    # stored path relative to uploads dir
    original_name = Column(String,  nullable=False)
    content_type  = Column(String,  nullable=True)
    size          = Column(Integer, nullable=True)
    uploaded_at   = Column(String,  nullable=False)
    uploaded_by   = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)


class TicketProject(Base):
    """Project container — groups related tickets / tasks."""
    __tablename__ = "ticket_projects"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("ticket_customers.id", ondelete="SET NULL"), nullable=True, index=True)
    name        = Column(String,  nullable=False)
    description = Column(Text,    nullable=True)
    status      = Column(String,  nullable=False, default="planning")  # planning | active | on_hold | completed | cancelled
    priority    = Column(String,  nullable=False, default="medium")
    start_date  = Column(String,  nullable=True)
    end_date    = Column(String,  nullable=True)
    manager_id  = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(String,  nullable=False)
    updated_at  = Column(String,  nullable=False)


class ChangeRequest(Base):
    """Change management metadata attached to a change ticket."""
    __tablename__ = "change_requests"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id           = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, unique=True)
    change_type         = Column(String,  nullable=False, default="standard")  # standard | emergency | normal
    impact              = Column(String,  nullable=False, default="low")       # low | medium | high
    risk                = Column(String,  nullable=False, default="low")
    implementation_plan = Column(Text,    nullable=True)
    rollback_plan       = Column(Text,    nullable=True)
    scheduled_start     = Column(String,  nullable=True)
    scheduled_end       = Column(String,  nullable=True)
    approval_status     = Column(String,  nullable=False, default="pending")  # pending | approved | rejected
    approved_by         = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    approved_at         = Column(String,  nullable=True)


class KBCategory(Base):
    """Knowledge base category (nestable)."""
    __tablename__ = "kb_categories"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String,  nullable=False)
    description = Column(String,  nullable=False, default="")
    parent_id   = Column(Integer, ForeignKey("kb_categories.id", ondelete="SET NULL"), nullable=True)
    customer_id = Column(Integer, ForeignKey("ticket_customers.id", ondelete="CASCADE"), nullable=True)  # null = global
    icon        = Column(String,  nullable=False, default="📄")
    sort_order  = Column(Integer, nullable=False, default=0)


class KBArticle(Base):
    """Knowledge base article."""
    __tablename__ = "kb_articles"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    category_id = Column(Integer, ForeignKey("kb_categories.id", ondelete="SET NULL"), nullable=True)
    customer_id = Column(Integer, ForeignKey("ticket_customers.id", ondelete="CASCADE"), nullable=True)  # null = global
    title       = Column(String,  nullable=False)
    slug        = Column(String,  nullable=False, unique=True, index=True)
    content     = Column(Text,    nullable=False, default="")
    summary     = Column(String,  nullable=False, default="")
    status      = Column(String,  nullable=False, default="draft")  # draft | published | archived
    tags        = Column(String,  nullable=False, default="[]")     # JSON list
    author_id   = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    view_count  = Column(Integer, nullable=False, default=0)
    helpful_yes = Column(Integer, nullable=False, default=0)
    helpful_no  = Column(Integer, nullable=False, default=0)
    created_at  = Column(String,  nullable=False)
    updated_at  = Column(String,  nullable=False)


class TicketSystemConfig(Base):
    """Single-row table storing ticket system configuration as a JSON blob."""
    __tablename__ = "ticket_system_config"

    id       = Column(Integer, primary_key=True, default=1)
    settings = Column(Text, nullable=False, default="{}")


class ProblemRecord(Base):
    """Problem management metadata attached to a problem ticket."""
    __tablename__ = "problem_records"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id         = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, unique=True)
    root_cause        = Column(Text,    nullable=True)
    workaround        = Column(Text,    nullable=True)
    known_error       = Column(Boolean, nullable=False, default=False)
    affected_services = Column(String,  nullable=True)  # free-text list of affected services/systems


class ProblemAsset(Base):
    """Asset (device, system, etc.) linked to a problem ticket."""
    __tablename__ = "problem_assets"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id         = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_type        = Column(String,  nullable=False, default="device")  # device | server | network | other
    asset_name        = Column(String,  nullable=False)
    asset_identifier  = Column(String,  nullable=True)   # serial, IP, hostname, etc.
    device_record_id  = Column(Integer, ForeignKey("device_records.id", ondelete="SET NULL"), nullable=True)
    added_at          = Column(String,  nullable=False)


# ── Procurement ───────────────────────────────────────────────────────────────

class Contract(Base):
    """Vendor contract record."""
    __tablename__ = "contracts"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    number        = Column(String,  nullable=False, unique=True, index=True)  # CON-00001
    vendor_name   = Column(String,  nullable=False)
    contract_type = Column(String,  nullable=False, default="service")  # SLA | licensing | maintenance | service | hardware | software | other
    status        = Column(String,  nullable=False, default="draft")    # draft | active | expired | pending | cancelled
    value         = Column(Float,   nullable=True)    # total contract value
    start_date    = Column(String,  nullable=True)
    end_date      = Column(String,  nullable=True)
    renewal_date  = Column(String,  nullable=True)
    auto_renewal  = Column(Boolean, nullable=False, default=False)
    description   = Column(Text,    nullable=True)
    notes         = Column(Text,    nullable=True)
    created_by    = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    created_at    = Column(String,  nullable=False)
    updated_at    = Column(String,  nullable=False)


class PurchaseOrder(Base):
    """Purchase order."""
    __tablename__ = "purchase_orders"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    number            = Column(String,  nullable=False, unique=True, index=True)  # PO-00001
    vendor_name       = Column(String,  nullable=False)
    status            = Column(String,  nullable=False, default="draft")  # draft | submitted | approved | received | cancelled
    requested_by      = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    approved_by       = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)
    approved_at       = Column(String,  nullable=True)
    expected_delivery = Column(String,  nullable=True)
    contract_id       = Column(Integer, ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True)
    notes             = Column(Text,    nullable=True)
    total             = Column(Float,   nullable=False, default=0.0)  # denormalised sum of line items
    created_at        = Column(String,  nullable=False)
    updated_at        = Column(String,  nullable=False)


class POLineItem(Base):
    """Line item on a purchase order."""
    __tablename__ = "po_line_items"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    po_id       = Column(Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String,  nullable=False)
    quantity    = Column(Float,   nullable=False, default=1.0)
    unit_price  = Column(Float,   nullable=False, default=0.0)
    tax_rate    = Column(Float,   nullable=False, default=0.0)   # percentage, e.g. 8.5 = 8.5%
    tax_amount  = Column(Float,   nullable=False, default=0.0)   # unit_price * quantity * tax_rate / 100
    total       = Column(Float,   nullable=False, default=0.0)   # (quantity * unit_price) + tax_amount
    sort_order  = Column(Integer, nullable=False, default=0)


class POReceivedAsset(Base):
    """Asset received against a purchase order — either linked from device inventory or manually entered."""
    __tablename__ = "po_received_assets"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    po_id            = Column(Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    device_record_id = Column(Integer, ForeignKey("device_records.id",  ondelete="SET NULL"), nullable=True)
    asset_name       = Column(String,  nullable=False)
    asset_type       = Column(String,  nullable=False, default="device")
    serial_number    = Column(String,  nullable=True)
    model            = Column(String,  nullable=True)
    notes            = Column(String,  nullable=True)
    received_at      = Column(String,  nullable=False)


class Asset(Base):
    """Manually-managed internal asset — covers hand-entered items and PO-received equipment."""
    __tablename__ = "assets"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    tag              = Column(String,  nullable=False, unique=True, index=True)   # AST-00001
    name             = Column(String,  nullable=False)
    asset_type       = Column(String,  nullable=False, default="device")          # device|server|network|peripheral|software|other
    status           = Column(String,  nullable=False, default="active")          # active|in_storage|retired|lost|disposed

    serial_number    = Column(String,  nullable=True)
    manufacturer     = Column(String,  nullable=True)
    model            = Column(String,  nullable=True)
    purchase_price   = Column(Float,   nullable=True)
    purchase_date    = Column(String,  nullable=True)
    warranty_expiry  = Column(String,  nullable=True)

    assigned_to      = Column(String,  nullable=True)   # user email
    assigned_name    = Column(String,  nullable=True)
    location         = Column(String,  nullable=True)

    # Optional links
    customer_id          = Column(Integer, ForeignKey("ticket_customers.id",   ondelete="SET NULL"), nullable=True, index=True)
    po_received_asset_id = Column(Integer, ForeignKey("po_received_assets.id", ondelete="SET NULL"), nullable=True)
    device_record_id     = Column(Integer, ForeignKey("device_records.id",     ondelete="SET NULL"), nullable=True)

    notes            = Column(Text,    nullable=True)
    created_at       = Column(String,  nullable=False)
    updated_at       = Column(String,  nullable=False)
    created_by       = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)


# ── Ticket KB & Asset links ───────────────────────────────────────────────────

class TicketKBLink(Base):
    """Many-to-many: links a KB article to any ticket type."""
    __tablename__ = "ticket_kb_links"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id      = Column(Integer, ForeignKey("tickets.id",     ondelete="CASCADE"), nullable=False, index=True)
    kb_article_id  = Column(Integer, ForeignKey("kb_articles.id", ondelete="CASCADE"), nullable=False)
    linked_at      = Column(String,  nullable=False)


class TicketInventoryAssetLink(Base):
    """Many-to-many: links an inventory Asset to any ticket type."""
    __tablename__ = "ticket_inventory_asset_links"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id  = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id   = Column(Integer, ForeignKey("assets.id",  ondelete="CASCADE"), nullable=False)
    linked_at  = Column(String,  nullable=False)


# ── Notification System ───────────────────────────────────────────────────────

class NotificationRule(Base):
    """Configurable rule that determines when an in-app notification fires."""
    __tablename__ = "notification_rules"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    name         = Column(String,  nullable=False)
    description  = Column(String,  nullable=False, default="")
    trigger_type = Column(String,  nullable=False)   # ticket_assigned | ticket_group_assigned | ticket_status_changed | ticket_commented | ticket_priority_changed | ticket_resolved
    conditions   = Column(Text,    nullable=False, default="{}")   # JSON: extra conditions e.g. {"priority": ["high","critical"]}
    enabled      = Column(Boolean, nullable=False, default=True)   # global default
    is_system    = Column(Boolean, nullable=False, default=False)  # built-in rules cannot be deleted
    created_at   = Column(String,  nullable=False)


class NotificationRuleOverride(Base):
    """Per-client override of a notification rule's enabled state."""
    __tablename__ = "notification_rule_overrides"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    rule_id     = Column(Integer, ForeignKey("notification_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("ticket_customers.id",   ondelete="CASCADE"), nullable=False, index=True)
    enabled     = Column(Boolean, nullable=False)


class TicketGroupMember(Base):
    """Maps a staff user to a ticket group so they receive group-assigned notifications."""
    __tablename__ = "ticket_group_members"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("ticket_groups.id",  ondelete="CASCADE"), nullable=False, index=True)
    user_id  = Column(String,  ForeignKey("user_records.id",   ondelete="CASCADE"), nullable=False)


class Notification(Base):
    """In-app notification delivered to a specific staff user."""
    __tablename__ = "notifications"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(String,  nullable=False, index=True)   # Azure AD OID
    title         = Column(String,  nullable=False)
    body          = Column(String,  nullable=False, default="")
    type          = Column(String,  nullable=False)               # matches trigger_type
    ticket_id     = Column(Integer, ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True)
    ticket_number = Column(String,  nullable=True)
    customer_id   = Column(Integer, nullable=True)
    read          = Column(Boolean, nullable=False, default=False)
    created_at    = Column(String,  nullable=False, index=True)


class ClientIntegration(Base):
    """Per-client integration credentials. One of each type per client."""
    __tablename__ = "client_integrations"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    customer_id      = Column(Integer, ForeignKey("ticket_customers.id", ondelete="CASCADE"), nullable=False, index=True)
    integration_type = Column(String,  nullable=False)          # e.g. "freshservice"
    label            = Column(String,  nullable=True)           # optional display name
    values_json      = Column(Text,    nullable=False, default='{}')  # JSON field values
    enabled          = Column(Boolean, nullable=False, default=True)
    created_at       = Column(String,  nullable=False)
    updated_at       = Column(String,  nullable=False)


class ProcurementAttachment(Base):
    """File attachment on a contract or purchase order."""
    __tablename__ = "procurement_attachments"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    record_type   = Column(String,  nullable=False)   # contract | po
    record_id     = Column(Integer, nullable=False, index=True)
    filename      = Column(String,  nullable=False)
    original_name = Column(String,  nullable=False)
    content_type  = Column(String,  nullable=True)
    size          = Column(Integer, nullable=True)
    uploaded_at   = Column(String,  nullable=False)
    uploaded_by   = Column(String,  ForeignKey("user_records.id", ondelete="SET NULL"), nullable=True)


class Feature(Base):
    """One row per product feature. Enables/disables capabilities and stores per-feature config."""
    __tablename__ = "features"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    key         = Column(Text, nullable=False, unique=True)
    name        = Column(Text, nullable=False)
    description = Column(Text, nullable=False, default="")
    category    = Column(Text, nullable=False, default="general")
    enabled     = Column(Boolean, nullable=False, default=False)
    config      = Column(Text, nullable=False, default="{}")   # JSON
    updated_at  = Column(Text, nullable=False, default="")
    updated_by  = Column(Text, nullable=False, default="")


class AuditLog(Base):
    """Immutable record of every administrative action taken in ControlPoint."""
    __tablename__ = "audit_logs"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp    = Column(DateTime(timezone=True), server_default=func.now())
    actor_id     = Column(Text)
    actor_email  = Column(Text)
    actor_name   = Column(Text)
    action       = Column(Text, nullable=False)
    category     = Column(Text, nullable=False)
    target_type  = Column(Text)
    target_id    = Column(Text)
    target_label = Column(Text)
    detail       = Column(Text)
    extra        = Column(Text)   # JSON string (named 'extra' — 'metadata' is reserved by SQLAlchemy)
