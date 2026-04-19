from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, Table, Text, Index
from sqlalchemy.orm import relationship
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
    user_id         = Column(String, nullable=False, index=True)   # Azure AD OID
    user_name       = Column(String, nullable=False)
    extension_id    = Column(String, nullable=False)
    status          = Column(String, nullable=False)               # Available | Busy | On Call | DND | Lunch | Break | Offline
    dnd_status      = Column(String, nullable=True)                # raw RC dndStatus value
    user_status     = Column(String, nullable=True)                # raw RC userStatus value
    changed_by_id   = Column(String, nullable=True)                # Azure AD OID of who triggered the change
    changed_by_name = Column(String, nullable=True)
    source          = Column(String, nullable=False, default="manual")  # manual | poll
    timestamp       = Column(String, nullable=False, index=True)   # ISO 8601 UTC
