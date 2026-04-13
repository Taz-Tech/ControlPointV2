from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, Table
from sqlalchemy.orm import relationship
from .database import Base


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

    id   = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)

    switches   = relationship('Switch',   secondary=site_switches)
    floor_maps = relationship('FloorMap', secondary=site_maps)


class Switch(Base):
    __tablename__ = "switches"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    ip_address = Column(String, nullable=False)
    stack_position = Column(Integer, default=1)

    seat_mappings = relationship("SeatMapping", back_populates="switch", cascade="all, delete-orphan")


class FloorMap(Base):
    __tablename__ = "floor_maps"

    id       = Column(Integer, primary_key=True, index=True)
    name     = Column(String, nullable=False)
    filename = Column(String, nullable=False)  # saved file path relative to uploads dir
    rotation = Column(Integer, nullable=False, default=0)  # 0 | 90 | 180 | 270

    seats = relationship("SeatMapping", back_populates="floor_map", cascade="all, delete-orphan")


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
