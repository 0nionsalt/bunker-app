# VAULT // Bunker Command

> A full-stack bunker planning and management system — build your bunker, design its layout, track supplies, and manage your crew. Military-grade dashboard included.

![Docker](https://img.shields.io/badge/Docker-required-2496ED?logo=docker&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-20_Alpine-339933?logo=node.js&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx-Alpine-009639?logo=nginx&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-persisted-003B57?logo=sqlite&logoColor=white)

---

## Prerequisites

Before you begin, make sure you have the following installed:

- **Docker** — [https://docs.docker.com/get-docker](https://docs.docker.com/get-docker/)
- **Docker Compose** — included with Docker Desktop; or install the [Compose plugin](https://docs.docker.com/compose/install/) on Linux

Verify both are working:

```bash
docker --version
docker compose version
```

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/0nionsalt/bunker-app.git
cd bunker-app
```

### 2. Set up your environment

```bash
cp .env.example .env
```

Open `.env` and set a strong secret key:

```env
PORT=7532
JWT_SECRET=your-secret-key-here
```

> ⚠️ **Important:** Never use the default `JWT_SECRET` in production.

### 3. Build and start the containers

```bash
docker compose up -d --build
```

This will:
- Build the Node.js API image
- Build the Nginx frontend image
- Start both containers in the background
- Create a persistent volume for your database

### 4. Open the app

```
http://localhost:7532
```

**Default admin login:**

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin123` |

> 🔒 Change the admin password after your first login.

---

## What You Can Do

### Bunker Builder
Create and name your bunkers, set capacity, and track their status from `planning` through `active` to `sealed`.

### Layout Designer
Use the interactive 20×15 grid to place rooms — Command Centre, Dormitory, Medical Bay, Armoury, Comms Room, Generator Room, and more. Click any room on the grid to inspect or remove it.

### Supplies Inventory
Track everything your bunker needs across 7 categories: Food, Water, Medical, Tools, Weapons, Comms, and Other. Set minimum thresholds and see stock health at a glance with colour-coded progress bars.

### User Roles
Three levels of access keep things organised:

| Role | What they can do |
|---|---|
| **Admin** | Full system access — manage all users, bunkers, and assign roles |
| **Commander** | Create and manage their own bunkers, invite members |
| **Member** | View and contribute to bunkers they're part of |

### Personnel Management
Invite other registered users to your bunker by callsign. Admins can promote any user to Commander or Admin from the All Personnel panel.

---

## Managing Containers

```bash
# View running containers and their status
docker compose ps

# View live logs
docker compose logs -f

# View logs for a specific service
docker compose logs -f api
docker compose logs -f web

# Stop the app (data is preserved)
docker compose down

# Stop and wipe all data (destructive!)
docker compose down -v

# Restart after a config change
docker compose up -d --build
```

---

## Configuration

All options live in your `.env` file:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7532` | The port the web UI is served on |
| `JWT_SECRET` | *(example value)* | Secret used to sign login tokens — **must be changed** |

To change the port, edit `.env` and restart:

```bash
# .env
PORT=9090
```

```bash
docker compose up -d --build
```

---

## Data & Persistence

Your bunker data is stored in a named Docker volume called `bunker-data`. It survives container restarts and rebuilds automatically.

To back up your database:

```bash
docker run --rm \
  -v bunker-app_bunker-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/bunker-backup.tar.gz /data
```

To restore from a backup:

```bash
docker run --rm \
  -v bunker-app_bunker-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/bunker-backup.tar.gz -C /
```

---

## Services

| Container | Base Image | Internal Port | Role |
|---|---|---|---|
| `bunker-api` | Node 20 Alpine | 3001 | REST API + SQLite database |
| `bunker-web` | Nginx Alpine | 80 → **7532** | SPA frontend + API proxy |

The frontend container proxies all `/api/` requests to the API container internally — no CORS issues, no exposed API port.

---

## Troubleshooting

**App won't start / port already in use**

Change the port in `.env` and restart, or find what's using port 8080:

```bash
lsof -i :7532
```

**`docker compose` command not found**

Try the older syntax `docker-compose` (with a hyphen), or install the [Compose plugin](https://docs.docker.com/compose/install/).

**API container keeps restarting**

Check the logs:

```bash
docker compose logs api
```

**Lost admin password**

Exec into the API container and reset it manually:

```bash
docker exec -it bunker-api sh
node -e "
const db = require('better-sqlite3')('/data/bunker.db');
const bcrypt = require('bcryptjs');
db.prepare('UPDATE users SET password=? WHERE username=?').run(bcrypt.hashSync('newpassword', 10), 'admin');
console.log('done');
"
```

---

## Security Checklist for Production

- [ ] Set a strong, unique `JWT_SECRET` in `.env`
- [ ] Change the default `admin` password on first login
- [ ] Put the app behind a reverse proxy (Caddy, Traefik, or Nginx) with HTTPS
- [ ] Restrict Docker socket access
- [ ] Schedule regular database backups

---

## License

MIT — do what you want, survive accordingly.
