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

#### NEC Required Loads

NEC 220.82 mandates three base loads that must be included regardless of actual usage. The calculator handles these separately from the appliance table:

| Load | Rule | Calculation |
|------|------|-------------|
| General lighting & receptacles | 220.82(B)(1) | 3 VA × total conditioned sq ft |
| Kitchen small appliance circuits | 220.52(A) | 1,500 VA × number of 20A circuits (min. 2) |
| Laundry branch circuit | 220.52(B) | 1,500 VA fixed |

Enter your home's total conditioned square footage (outside dimensions, excluding garages and unfinished spaces) and the calculator computes the general load automatically. **Do not add individual lighting or receptacle circuits to the appliance table** — they are already covered by the sq ft calculation.

The laundry circuit (1,500 VA) covers the washer outlet. The dryer is a separate named appliance in the table.

#### Appliance & Motor Loads

Add fastened-in-place appliances and motor loads individually: HVAC, water heater, dryer, EV charger, etc.

**Enter the equipment's actual maximum draw — not the breaker size.** A 32 A EV charger on a 40A circuit should be entered as 32 A. The 40 A recommendation already includes the NEC 125% continuous-load safety factor; using it as the input overstates the demand by 25% and pushes the breaker recommendation one size too high.

#### HVAC — larger of heating or cooling (NEC 220.82(C))

Include **only the larger** of your heating load or cooling load, not both. If your AC compressor draws more than your electric heat strips, enter the AC and omit the heat strips; if heat strips are larger, do the reverse.

The **furnace fan / air handler blower** is not subject to this rule — it runs year-round and belongs in the appliance table separately at its motor amps regardless of which HVAC mode you select.

#### Sub-Panels

Sub-panels are calculated independently using the same NEC 220.82 demand factors, then contribute their **demand VA** (not their connected VA) to the main panel total. The feeder breaker from the main panel to a sub-panel is sized at the sub-panel's rated capacity, not its demand.

#### How the numbers are calculated

**Step 1 — VA per load**

Every load is expressed in volt-amperes (VA):

```
VA = circuit amps × circuit voltage × quantity
```

Circuit voltage matters. A 30 A HVAC circuit at 240 V contributes 7,200 VA. A 15 A circuit at 120 V contributes only 1,800 VA. Summing raw amps across a mixed 120 V / 240 V panel produces meaningless results.

**Step 2 — Connected Load**

Sum of all VA (required loads + appliances + sub-panel demand contributions). Divide by 240 to get equivalent service amps:

```
connected amps = total VA ÷ 240
```

All North American residential services are 120/240 V split-phase. Panel capacity is always expressed at 240 V.

**Step 3 — NEC Demand Load (NEC 220.82)**

Demand factors are applied to the connected VA total:

```
first 10,000 VA  →  100%
remaining VA     →   40%

demand VA  = 10,000 + (total VA − 10,000) × 0.40   (when total VA > 10,000)
demand A   = demand VA ÷ 240
```

This is why a panel that looks "full" on a raw amp-sum basis often has substantial real headroom. Example: a home with 50,000 VA connected has a demand load of only 26,000 VA = **108 A** on a 200 A panel.

**Step 4 — Load %**

```
load % = demand amps ÷ panel amps × 100
```

Above 80% the tool warns; above 100% it flags an overload.

---

#### What the Continuous (Cont.) checkbox does — and does not do

Marking a load as **continuous** (expected to run for 3 or more hours uninterrupted) does **not** affect the service demand calculation. The NEC 220.82 Optional Method does not apply a continuous-load multiplier to the demand total.

What it *does* affect is **minimum breaker size**. Per NEC 210.20(A), the breaker for a continuous load must be rated at no less than **125% of the load**:

```
minimum breaker amps = circuit amps × 1.25, rounded up to next standard size
```

Standard sizes: 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100 A …

Example: a 32 A continuous EV charger requires a minimum **40 A breaker** (32 × 1.25 = 40). The demand total and headroom numbers are unaffected.

#### Typical appliance loads for reference

| Load | Typical amps | Voltage | VA |
|------|-------------|---------|-----|
| HVAC / heat pump compressor | 20–60 A | 240 V | 4,800–14,400 |
| Furnace blower / air handler | 5–10 A | 120 V | 600–1,200 |
| Electric range | 50 A | 240 V | 12,000 |
| Electric dryer | 30 A | 240 V | 7,200 |
| Water heater | 25–30 A | 240 V | 6,000–7,200 |
| EV charger (Level 2) | 24–48 A | 240 V | 5,760–11,520 |
| Dishwasher | 12–15 A | 120 V | 1,440–1,800 |
| Refrigerator | 6 A | 120 V | 720 |
| Microwave | 15 A | 120 V | 1,800 |

An official load calculation by a licensed electrician is required before any service change or panel upgrade.

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

**Overhead:**
- RAM: ~68MB
- CPU: negligible