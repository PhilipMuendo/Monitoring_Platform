# Solar Fleet Monitor

A self-hosted, single-pane-of-glass dashboard that consolidates 50+ solar sites across three inverter brands (Deye, Ingecon, Sosen) into one live view — real-time status, automatic problem detection, historical power curves, and a wall-display mode for the office TV.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system design and rationale, [`docs/DATABASE.md`](docs/DATABASE.md) for the schema, and [`docs/API.md`](docs/API.md) for the full REST/SSE reference.

## Stack

| Layer | Technology |
|---|---|
| Backend | Go (single static binary) — chi router, pgx, JWT auth |
| Database | PostgreSQL 15 + TimescaleDB (hypertables, compression) |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui |
| Charts | Recharts |
| Data fetching | TanStack Query (polling + cache) |
| Animation | Framer Motion |
| Auth | Self-hosted JWT (email/password, bcrypt, role-based) |
| Hosting | Single VPS via Docker Compose |

> **Deviation from the original brief:** the brief suggested Clerk for auth, but Clerk is a hosted third-party SaaS, which conflicts with the brief's own "self-hosted" requirement and adds an external dependency + monthly cost for a 50-site internal tool. We ship a small, audited JWT auth module instead (bcrypt hashing, access/refresh tokens, `admin` / `technician` / `viewer` roles). Swapping in Clerk later is a contained change to `backend/internal/auth` and the frontend auth provider — see the ADR in `docs/ARCHITECTURE.md`.

## Quickstart (Docker Compose — recommended)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- Postgres: localhost:5433 (mapped off the default 5432 to avoid clashing with a native Postgres install)

Every reading the platform shows is polled live from an inverter portal — there is no synthetic or seeded data anywhere in the stack. Fill in at least one brand's credentials (`DEYE_*`, `INGECON_*` or `SOSEN_*`) in `.env` before starting; a brand left blank is skipped, and with all three blank the backend exits at boot with a message naming the variables it needs.

Because history is built purely from live polling, a fresh database starts with empty charts and fills in one `POLL_INTERVAL` at a time — expect a few hours before the 24-hour views are meaningful.

### Operational endpoints

| Path | Purpose |
|---|---|
| `/healthz` | Liveness. Process-only — deliberately does not touch the DB, since a liveness probe that fails during a database outage makes the orchestrator restart every replica in a loop |
| `/health` | Readiness. Pings the DB and returns **503** when it is unreachable; a stalled collector reports `degraded` but stays in rotation, because the API is still serving correct history |
| `/metrics` | Prometheus. Cycle duration, per-brand online/offline/**unknown**, vendor API latency and outcome, alert and login counters. Unauthenticated by design (a scraper has no session) — bind internally or restrict at the proxy |

Every response carries an `X-Request-Id`, echoing an upstream value when present, so a user can quote an id from a failed request instead of you grepping by timestamp.

A seed admin user is created on first boot: **admin@solarfleet.local / ChangeMe123!** — change this immediately in production.

## Local development (without Docker)

**Backend**
```bash
cd backend
cp .env.example .env
go run ./cmd/server
```

> `cmd/server` reads configuration from the process environment, not from
> `.env` — nothing in the binary parses a dotenv file. Export the values
> first (`set -a; . ./.env; set +a` on a POSIX shell) or pass them inline.
> Under Docker Compose this is handled for you.

**Frontend**
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Backend requires a reachable Postgres+TimescaleDB instance (run `docker compose up db` to get just the database). Note that `.env.example` points at host port **5433**, since Compose maps the database off 5432 to avoid clashing with a native Postgres install.

**If port 8080 is already taken** (Apache/XAMPP and IIS commonly own it on Windows), change it in *both* places or the frontend will silently fail every request:

```bash
# backend/.env
PORT=8081
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8081
```

## Repository layout

```
Monitoring_Platform/
├── backend/            Go single-binary API + polling engine + alert engine
├── frontend/            Next.js dashboard
├── docs/                Architecture, database, API reference
└── docker-compose.yml
```
