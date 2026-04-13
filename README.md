# IT Admin Portal

A full-stack internal IT administration portal for user lookup (Microsoft Graph API) and Cisco switch port security reset automation.

---

## Tech Stack

| Layer     | Tech                          |
|-----------|-------------------------------|
| Frontend  | React 18 + Vite               |
| Backend   | FastAPI + Python 3.10+        |
| Database  | SQLite (via SQLAlchemy async) |
| SSH       | Netmiko (Cisco IOS)           |
| Graph API | MSAL (client credentials)     |

---

## Project Structure

```
it-admin-portal/
├── backend/
│   ├── main.py              ← FastAPI app entry point
│   ├── database.py          ← SQLAlchemy async engine
│   ├── models.py            ← DB models (Switch, FloorMap, SeatMapping)
│   ├── auth.py              ← MSAL Graph token helper
│   ├── routers/
│   │   ├── users.py         ← GET /api/users/search, /api/users/{id}
│   │   ├── switches.py      ← CRUD + POST /api/switches/reset-port
│   │   └── maps.py          ← Floor plan upload + seat pin CRUD
│   ├── uploads/             ← Floor plan images (auto-created)
│   ├── requirements.txt
│   └── .env.example         ← Copy to .env and fill in Azure values
└── frontend/
    ├── index.html
    ├── vite.config.js       ← Proxies /api → localhost:8000
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx           ← Shell, sidebar nav, credentials context
        ├── index.css         ← Full dark-mode design system
        ├── api/client.js     ← Axios wrappers for all API calls
        └── components/
            ├── UserLookup.jsx
            ├── DeploymentTools.jsx
            ├── SwitchCredentialsModal.jsx
            └── PortSecurity/
                ├── FloorMapManager.jsx       ← Upload map, place/edit seat pins
                ├── SwitchStackVisualizer.jsx ← Visual switch stack diagram
                └── PortResetPanel.jsx        ← Select seat → push SSH reset
```

---

## Ubuntu Server Setup

### 1. Prerequisites

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip nodejs npm git curl
```

### 2. Clone / Copy Project

```bash
# Copy the it-admin-portal folder to your Ubuntu server, then:
cd /opt
sudo mkdir it-admin-portal
sudo chown $USER it-admin-portal
cp -r /path/to/it-admin-portal/* /opt/it-admin-portal/
cd /opt/it-admin-portal
```

### 3. Backend Setup

```bash
cd /opt/it-admin-portal/backend

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
nano .env   # fill in AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET

# Start the backend (dev)
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

> **Run from the project root** (`/opt/it-admin-portal`) so relative imports work:
> ```bash
> cd /opt/it-admin-portal
> source backend/venv/bin/activate
> uvicorn backend.main:app --host 0.0.0.0 --port 8000
> ```

### 4. Frontend Setup

```bash
cd /opt/it-admin-portal/frontend
npm install
npm run dev -- --host 0.0.0.0
```

Access the portal at: `http://<your-server-ip>:5173`

---

### 5. Run as systemd Services (Production)

**Backend service** (`/etc/systemd/system/it-admin-backend.service`):
```ini
[Unit]
Description=IT Admin Portal Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/it-admin-portal
EnvironmentFile=/opt/it-admin-portal/backend/.env
ExecStart=/opt/it-admin-portal/backend/venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now it-admin-backend
```

---

## Azure App Registration (for User Lookup)

1. Go to **Azure Portal** → **Azure Active Directory** → **App registrations** → **New registration**
2. Name: `IT Admin Portal` | Supported account type: **Single tenant**
3. Click Register. Copy **Tenant ID** and **Application (client) ID** from Overview.
4. **Certificates & secrets** → New client secret → copy the **Value** (shown once only)
5. **API permissions** → Add a permission → **Microsoft Graph** → **Application permissions**:
   - `User.Read.All`
   - `AuditLog.Read.All` (for sign-in activity)
6. Click **Grant admin consent**
7. Paste values into `backend/.env`

---

## Usage

### Tab 1 — User Lookup
- Search by name, email, or UPN
- Click a result to view full profile: licenses, group memberships, last sign-in

### Tab 2 — Deployment Tools → Port Security Reset

1. **Set Switch Credentials** (top-right button) — enter SSH username/password once per session
2. **Floor Map Manager**:
   - Add switches to the registry (name, IP, stack position)
   - Upload a floor plan image (PNG/JPG)
   - Click anywhere on the map to drop a seat pin
   - Assign each pin a seat label (e.g. "A1"), switch, and port (e.g. `GigabitEthernet1/0/5`)
3. **Switch Stack Visualizer** — see all switches with their mapped ports
4. **Port Reset Panel** — click a seat pin → confirm target info → click "Reset Port Security"

The reset sequence pushed to the switch:
```
interface GigabitEthernet1/0/X
 shutdown
!
clear port-security sticky interface GigabitEthernet1/0/X
!
interface GigabitEthernet1/0/X
 no shutdown
```
