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

By default `USE_MOCK_ADAPTERS=true`, so the backend generates realistic synthetic data for 50 demo sites across all three brands — no real credentials needed to see the whole system working end to end. Flip it off and fill in `DEYE_*` / `INGECON_*` / `SOSEN_*` once real credentials are available.

A seed admin user is created on first boot: **admin@solarfleet.local / ChangeMe123!** — change this immediately in production.

## Local development (without Docker)

**Backend**
```bash
cd backend
cp .env.example .env
go run ./cmd/server
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Backend requires a reachable Postgres+TimescaleDB instance (run `docker compose up db` to get just the database).

## Repository layout

```
Monitoring_Platform/
├── backend/            Go single-binary API + polling engine + alert engine
├── frontend/            Next.js dashboard
├── docs/                Architecture, database, API reference
└── docker-compose.yml
```
