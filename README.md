# 🏠 Home Planner

A self-hosted home improvement project planner with budgeting, ROI tracking, home value projection, and a project calendar. Runs entirely on your local network via Docker Compose.

## Stack

- **Frontend**: React + Vite + Tailwind CSS (served by nginx)
- **Backend**: Node.js + Express + Prisma ORM
- **Database**: PostgreSQL (persisted in a named Docker volume)

## Requirements

- Docker
- Docker Compose v2 (plugin syntax)

### Install Docker on Garuda/Arch Linux

```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Log out and back in after this
```

## Quick Start

```bash
# Clone or copy this project to your server
cd home-planner

# Set up credentials (required before first run)
cp .env.example .env
# Edit .env and set a real POSTGRES_PASSWORD and matching DATABASE_URL

# Build images
docker build -t home-planner-backend:latest ./backend
docker build -t home-planner-frontend:latest ./frontend

# Start everything
docker compose up -d

# View logs
docker compose logs -f

# App is now available at:
# http://localhost:3000         (from the server itself)
# http://<server-ip>:3000       (from any device on your network)
```

> **Note:** `docker compose up -d --build` requires buildx 0.17+. If your system has an older version, use the two `docker build` commands above followed by `docker compose up -d`.

## First Run

1. Open the app in your browser
2. Go to **Settings** and enter your current home value and location
3. Go to **Projects** or **Backlog** and start adding projects
4. Categories auto-fill ROI benchmarks from Cost vs. Value data

## Stopping / Starting

```bash
# Stop (data is preserved)
docker compose down

# Start again
docker compose up -d

# Full rebuild (after code changes)
docker compose up -d --build
```

## Data Backup

Your data lives in a named Docker volume `homeplanner-pgdata`. To back it up:

```bash
# Dump to SQL file
docker exec homeplanner-db pg_dump -U homeplanner homeplanner > backup-$(date +%Y%m%d).sql

# Restore from backup
docker exec -i homeplanner-db psql -U homeplanner homeplanner < backup-20260101.sql
```

Or use the **Export** buttons in Settings to download JSON or CSV.

## Ports

| Service  | Host port | Notes |
|----------|-----------|-------|
| Frontend | 3000 | nginx — the only entry point |
| API      | — | Internal Docker network only; nginx proxies `/api/` |
| Postgres | — | Internal Docker network only |

To change the frontend port, edit `docker-compose.yml`:
```yaml
ports:
  - "8080:80"   # change 8080 to whatever you want
```

## Project Structure

```
home-planner/
├── docker-compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── src/
│   │   ├── pages/         # Dashboard, Projects, Backlog, Calendar, Settings
│   │   ├── components/    # Layout, ProjectModal
│   │   ├── api/           # API client
│   │   └── utils.js       # Shared helpers
└── backend/
    ├── Dockerfile
    ├── src/
    │   ├── index.js
    │   └── routes/        # settings, projects, backlog, benchmarks, export
    └── prisma/
        ├── schema.prisma
        ├── seed.js         # ROI benchmark data
        └── migrations/
```

## Tools

The Tools page contains a set of calculators for home improvement planning. Each is self-contained and runs entirely in the browser — no data is sent to the server.

---

### Electrical Load Calculator

Sizes a residential electrical service panel using the **NEC Article 220 Optional Method (Section 220.82)**. This is the same method a licensed electrician uses to determine whether an existing panel can support new loads (EV charger, heat pump, additional circuits, etc.) or whether a service upgrade is required.

#### How the numbers are calculated

**Step 1 — VA per load**

Every load is expressed in volt-amperes (VA), not just amps:

```
VA = circuit amps × circuit voltage × quantity
```

Circuit voltage matters. A 30 A HVAC circuit at 240 V contributes 7,200 VA. A 15 A lighting circuit at 120 V contributes only 1,800 VA. The original (naive) approach of summing amps without considering voltage produces meaningless results when your loads are a mix of 120 V and 240 V circuits, which they always are in a residential panel.

**Step 2 — Connected Load**

Sum of all VA across every row. Divide by 240 to get the equivalent service amps:

```
connected amps = total VA ÷ 240
```

All residential services in North America are 120/240 V split-phase. Panel capacity is always expressed at 240 V — this is why VA is always divided by 240 regardless of whether individual circuits are 120 V or 240 V.

**Step 3 — NEC Demand Load (NEC 220.82)**

The NEC recognises that not every load in a house runs simultaneously. Demand factors are applied to the connected VA total:

```
first 10,000 VA  →  100%
remaining VA     →   40%

demand VA  = 10,000 + (total VA − 10,000) × 0.40   (when total VA > 10,000)
demand A   = demand VA ÷ 240
```

This is why a panel that looks "full" on a raw amp-sum basis often has substantial real headroom. Example: a home with 50,000 VA connected has a demand load of only 26,000 VA = **108 A** on a 200 A panel — room for a 48 A EV charger circuit.

**Step 4 — Load %**

```
load % = demand amps ÷ panel amps × 100
```

NEC recommends keeping continuous service demand below 80% of panel rating for sustained loads. Above 80% the tool warns; above 100% it flags an overload.

---

#### What the Continuous (Cont.) checkbox does — and does not do

Marking a load as **continuous** (expected to run for 3 or more hours uninterrupted) does **not** affect the service demand calculation. The NEC 220.82 Optional Method does not apply a continuous-load multiplier to the demand total.

What it *does* affect is **minimum breaker size**. Per NEC 210.20(A), the overcurrent protective device (breaker) for a continuous load must be rated at no less than **125% of the load**:

```
minimum breaker amps = circuit amps × 1.25, rounded up to next standard size
```

Standard sizes: 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100 A …

Example: a 30 A continuous HVAC circuit requires a minimum **40 A breaker** (30 × 1.25 = 37.5 → next standard = 40). When you check Cont. for a load, a "Minimum breaker sizes" table appears below the results showing the required breaker for each continuous circuit. The demand total and headroom numbers do not change — this is correct behaviour.

#### Typical load voltages for reference

| Load | Typical amps | Voltage | VA |
|------|-------------|---------|-----|
| HVAC / heat pump | 20–60 A | 240 V | 4,800–14,400 |
| Electric range | 50 A | 240 V | 12,000 |
| Electric dryer | 30 A | 240 V | 7,200 |
| Water heater | 25–30 A | 240 V | 6,000–7,200 |
| EV charger (Level 2) | 32–48 A | 240 V | 7,680–11,520 |
| Dishwasher | 15 A | 120 V | 1,800 |
| Washer | 20 A | 120 V | 2,400 |
| Refrigerator | 6 A | 120 V | 720 |
| Microwave | 15 A | 120 V | 1,800 |
| Lighting circuit | 15 A | 120 V | 1,800 |
| Kitchen small appliance | 20 A | 120 V | 2,400 |

#### Known simplification

NEC 220.82 technically adds the HVAC load at 100% *on top of* the demand-factor-adjusted general load, rather than folding HVAC into the same demand pool as everything else. For a planning estimate this difference is minor, but on a heavily electrified home with large HVAC the calculator may slightly understate demand. The results panel notes this. An official load calculation by a licensed electrician is required before any service change or panel upgrade.

---

### Manual J Heat Load Calculator

Implements the ACCA Manual J residential heat load calculation method. Determines how much heating (BTU/hr) and cooling (tons) your home actually needs at your local design conditions — not averages, but the 99th-percentile cold / 1st-percentile hot temperatures for your city.

Use **Whole Home** mode for a single HVAC system, or **Zone-by-Zone** mode to calculate each furnace/AC pair independently and see a combined summary.

---

### Other Tools

| Tool | What it does |
|------|-------------|
| Paint & Materials | Calculates paint gallons and flooring area room-by-room, accounting for doors, windows, and waste factor |
| Duct Sizing | Sizes supply duct diameters (CFM per room → round duct diameter) using Manual J output and a target duct velocity |
| Energy Savings | Estimates annual kWh savings and payback period for insulation, window, HVAC, and air sealing upgrades |
| Break-Even | Tracks true break-even including savings growth rate, rebates/tax credits, and home value appreciation over 25 years |

---

## Troubleshooting

**App won't start:**
```bash
docker compose logs backend
docker compose logs db
```

**Database migration issues:**
```bash
docker compose down
docker volume rm homeplanner-pgdata   # WARNING: deletes all data
docker compose up -d --build
```

**Can't connect from other devices:**
- Make sure port 3000 isn't blocked by firewall: `sudo ufw allow 3000`
- Find your server IP: `ip addr show`
