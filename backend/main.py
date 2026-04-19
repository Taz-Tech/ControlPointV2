import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

from .database import create_all, seed_roles
from .routers import users, switches, maps, freshservice, mailboxes, settings, immybot, shortcuts, bookmarks, sites, integrations, devices, logitech_sync, intune, conference_rooms, room_configs, ringcentral, zones, roles as roles_router, unifi, directory, sso
from .jwt_middleware import AzureJWTMiddleware

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:5174",
).split(",")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all()
    await seed_roles()
    # Pre-warm the ImmyBot filter cache from SQLite so devices that are invisible
    # to unfiltered pagination (e.g. onboardingStatus=2) are available immediately
    # on the first request rather than waiting for background probes to find them.
    from .routers.devices import load_filter_cache_from_db
    await load_filter_cache_from_db()
    yield


app = FastAPI(
    title="ControlPoint API",
    version="1.0.0",
    lifespan=lifespan,
)

# JWT auth middleware — set AUTH_ENABLED=false in .env to bypass during dev
_auth_enabled = os.getenv("AUTH_ENABLED", "true").lower() != "false"
app.add_middleware(AzureJWTMiddleware, enabled=_auth_enabled)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded floor-plan images
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

app.include_router(users.router)
app.include_router(switches.router)
app.include_router(maps.router)
app.include_router(freshservice.router)
app.include_router(mailboxes.router)
app.include_router(settings.router)
app.include_router(immybot.router)
app.include_router(shortcuts.router)
app.include_router(bookmarks.router)
app.include_router(sites.router)
app.include_router(integrations.router)
app.include_router(devices.router)
app.include_router(logitech_sync.router)
app.include_router(intune.router)
app.include_router(conference_rooms.router)
app.include_router(room_configs.router)
app.include_router(ringcentral.router)
app.include_router(zones.router)
app.include_router(roles_router.router)
app.include_router(unifi.router)
app.include_router(directory.router)
app.include_router(sso.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}

