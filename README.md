# VAULT // Bunker Command

> A full-stack bunker planning and management system with user roles, dynamic room layout builder, supply tracking, and a military-industrial command dashboard.

---

## 🚀 Quick Start

```bash
git clone https://github.com/0nionsalt/bunker-app.git
cd bunker-app

# Start everything
docker compose up -d --build

# Open in browser
Let's get cracking! http://localhost:7532
```

**Default admin credentials:** `admin` / `admin123`
_(Change these immediately in production)_

---

## ✨ Features

### User Roles
| Role | Capabilities |
|---|---|
| **Admin** | Full system access, manage all users & bunkers, assign roles |
| **Commander** | Create & manage their own bunkers, invite members |
| **Member** | View and contribute to bunkers they belong to |

### Bunker Management
- Create multiple bunkers with name, description, and capacity
- Set status: `planning` → `active` → `sealed`
- Invite other registered users to your bunker

### Layout Builder (Grid Map)
- 20×15 interactive grid canvas
- 12 room types: Command Centre, Dormitory, Kitchen, Medical Bay, Armoury, Storage, Comms, Generator, Water Treatment, Recreation, Vehicle Bay, Airlock
- Click to place rooms on the grid; click rooms to inspect/remove
- Add Room modal for precise position and size control

### Supplies Inventory
- Track items by category: Food, Water, Medical, Tools, Weapons, Comms, Other
- Set quantity and minimum thresholds — progress bars show stock health
- Filter by category; edit or remove entries

### Dashboard
- Live stats: total bunkers, users, supply units, rooms mapped
- Quick-access bunker cards
- UTC clock with live heartbeat

---

## 🗂 Project Structure

```
bunker-app/
├── docker-compose.yml          # Service orchestration
├── .env.example                # Environment template
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js               # Express API + SQLite
├── frontend/
│   ├── Dockerfile
│   └── public/
│       └── index.html          # Full SPA (single file)
└── nginx/
    └── default.conf            # Reverse proxy config
```

---

## 🐳 Docker Services

| Service | Image | Port | Purpose |
|---|---|---|---|
| `api` | Node 20 Alpine | internal :3001 | REST API + SQLite DB |
| `web` | Nginx Alpine | :8080 | SPA + API reverse proxy |

Data is persisted in a named Docker volume (`bunker-data`).

---

## 🔧 Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7532` | External port for the web UI |
| `JWT_SECRET` | `change-me-in-production-2077` | JWT signing secret — **change this!** |

---

## 📡 API Endpoints

```
POST   /api/auth/register          Register a new user
POST   /api/auth/login             Login
GET    /api/users                  [admin] List all users
PATCH  /api/users/:id/role         [admin] Change user role
GET    /api/bunkers                List accessible bunkers
POST   /api/bunkers                Create a bunker
PATCH  /api/bunkers/:id            Update bunker details
DELETE /api/bunkers/:id            Delete a bunker
GET    /api/bunkers/:id/members    List bunker members
POST   /api/bunkers/:id/invite     Invite a user to bunker
GET    /api/bunkers/:id/rooms      Get rooms in layout
POST   /api/bunkers/:id/rooms      Add a room
PATCH  /api/rooms/:id              Update room position/size
DELETE /api/rooms/:id              Remove a room
GET    /api/bunkers/:id/supplies   List supplies
POST   /api/bunkers/:id/supplies   Add a supply item
PATCH  /api/supplies/:id           Update supply
DELETE /api/supplies/:id           Delete supply
GET    /api/stats                  System-wide stats
```

---

## 🔒 Security Notes

- Change `JWT_SECRET` before any public deployment
- Consider adding HTTPS via a reverse proxy (Traefik, Caddy)
- The default admin password should be changed on first login
- For production, consider replacing SQLite with PostgreSQL

---

## 🛠 Development

To run the API locally without Docker:

```bash
cd backend
npm install
node server.js
```

---

## � Updating

To update to the latest version:

```bash
git pull && docker compose up -d --build
```

---

## 🛠 Uninstallation

To completely remove the application and all its data:

```bash
docker compose down -v && cd .. && rm -rf bunker-app
```

The frontend is a single HTML file — open it in any browser or serve via any static server.
