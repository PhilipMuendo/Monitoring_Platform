# System Architecture

## 1. Overview

```
                                   ┌─────────────────────────────┐
                                   │      Brand Cloud APIs       │
                                   │  Deye · Ingecon · Sosen     │
                                   └───────────────┬─────────────┘
                                                    │ HTTPS (poll every 5m)
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         BACKEND — Go single binary                        │
│                                                                             │
│  ┌────────────┐   ┌──────────────┐   ┌───────────────┐   ┌─────────────┐ │
│  │ Scheduler  │──▶│  Collector    │──▶│ BrandAdapters │──▶│  Normalizer │ │
│  │ (ticker)   │   │ (fan-out,     │   │ Deye/Ingecon/ │   │ (SiteData)  │ │
│  │            │   │  bounded conc.)│   │ Sosen/Mock    │   │             │ │
│  └────────────┘   └──────────────┘   └───────────────┘   └──────┬──────┘ │
│                                                                    │        │
│                                                                    ▼        │
│  ┌────────────┐   ┌──────────────┐   ┌───────────────┐   ┌─────────────┐ │
│  │Alert Engine│◀──│   Storage     │──▶│  REST API     │──▶│ SSE Stream  │ │
│  │(state rules│   │ (pgx repos)   │   │  (chi router) │   │ (alerts)    │ │
│  │+cooldowns) │   └──────┬───────┘   └───────┬───────┘   └─────────────┘ │
│  └────────────┘          │                    │                          │
└───────────────────────────┼────────────────────┼──────────────────────────┘
                             ▼                    ▼
                  ┌─────────────────────┐   ┌───────────────────────┐
                  │ PostgreSQL 15 +      │   │   Next.js Frontend     │
                  │ TimescaleDB          │   │ (dashboard, admin,     │
                  │ (sites, metrics      │   │  wall display)         │
                  │  hypertable, alerts, │   │  TanStack Query polls  │
                  │  users)              │   │  REST + subscribes SSE │
                  └─────────────────────┘   └───────────────────────┘
```

## 2. Backend architecture

The backend is a single Go binary composed of independent, testable packages under `internal/`:

- **`config`** — loads/validates env vars into a typed struct once at boot.
- **`models`** — shared domain types (`Site`, `SiteData`, `Alert`, `User`) and the `BrandAdapter` interface.
- **`adapters`** — one package per brand implementing `BrandAdapter`. Each adapter owns its own auth flow, rate limiting and response normalization; the rest of the system never sees brand-specific shapes.
- **`collector`** — the scheduler ticks every `POLL_INTERVAL` (default 5m), fans out to all active adapters concurrently (bounded worker pool so 50+ sites don't open 50+ sockets at once), and hands normalized `SiteData` to storage + the alert engine.
- **`alerts`** — pure, state-based rule engine. Rules are evaluated against a rolling window of recent readings per site so a single bad reading never fires a false alarm; each rule has its own cooldown to prevent alert spam.
- **`storage`** — thin repository layer over `pgx`. All time-series reads/writes go through here so the rest of the app never writes raw SQL.
- **`auth`** — JWT issuance/verification, bcrypt password hashing, role middleware.
- **`api`** — chi router, HTTP handlers, request validation, SSE hub for live alert push.

### Why Go for this piece specifically
Polling 50+ remote APIs on a tight 5-minute budget, with three different auth flows and independent failure modes, is an I/O-bound fan-out problem — goroutines + a bounded semaphore make that trivial and cheap in memory, and a static binary means the whole backend deploys as one `scp` + `systemctl restart`, matching the brief's single-VPS budget.

### Why not Clerk for auth
The brief's own framing is "self-hosted web application," but Clerk is a hosted third-party identity provider — it works fine, but it means the login path for an internal 50-site ops tool now depends on an external SaaS's uptime and pricing tier. For a tool with a handful of named staff accounts (admin/technician/viewer), a small self-hosted JWT module is less operational surface, not more: no webhook sync, no external dashboard, no seat billing. It is intentionally minimal (bcrypt + signed JWT + refresh rotation) so it stays auditable. If the org later wants SSO/MFA/social login, swapping in Clerk (or Auth0/WorkOS) only touches `internal/auth` on the backend and the auth provider/hooks on the frontend — the rest of the app talks to `/api/v1/auth/*` and role claims either way.

### Adapter pattern & the Sosen contingency
`BrandAdapter` is the seam that keeps brand-specific mess out of the core system:

```go
type BrandAdapter interface {
    Name() string
    FetchAll(ctx context.Context) ([]models.SiteData, error)
    ValidateCredentials(ctx context.Context) error
    RateLimit() (requestsPerMinute int, resetWindow time.Duration)
}
```

- **Deye**: real HTTPS client implementing DeyeCloud's documented flow (SHA-256 password hash → `/account/token` → bearer token cached until its 60-day expiry, auto-refreshed).
- **Ingecon**: adapter skeleton with the same interface and a clearly marked integration point, ready to fill in once their API documentation/credentials are confirmed — the rest of the system doesn't care.
- **Sosen**: no public API exists today. The adapter is structured so a Playwright/chromedp-driven scraper can be dropped in behind the exact same interface without touching collector, storage, or the frontend — isolated and replaceable, per the brief's contingency plan.
- **Mock**: a fourth adapter that generates realistic synthetic readings (day/night PV curves, battery charge/discharge, occasional faults) for 50 demo sites split across all three brands. This is what runs by default (`USE_MOCK_ADAPTERS=true`) so the whole product — dashboard, alerts, charts, wall display — is demoable with zero external credentials. Swapping to real adapters is one env var.

## 3. Frontend architecture

Next.js App Router, server components for initial data where useful, client components for anything interactive/animated. TanStack Query owns all server-state caching and re-polls every 5 minutes to match the backend's collection cadence; an SSE subscription (`/api/v1/alerts/stream`) pushes new alerts immediately without waiting for the next poll.

```
app/
├── (auth)/login                 public
├── (dashboard)/dashboard        fleet overview — the main screen
├── (dashboard)/sites/[id]       per-site detail + historical charts
├── (dashboard)/admin/sites      CRUD for site inventory
└── (dashboard)/wall             big-screen rotating display, no chrome
```

Design system: Tailwind + shadcn/ui primitives (Card, Badge, Button, Table, Dialog, Progress, Tabs) restyled with the brief's solar palette, plus one bespoke piece — the **Fleet Power Flow** visualization (`components/dashboard/power-flow.tsx`) — an original animated SVG diagram (not a copy of any reference image) showing aggregate PV → Battery/Load/Grid flow with live wattage labels and directional particle animation via Framer Motion + SVG `stroke-dashoffset`.

## 4. Data flow (per 5-minute cycle)

1. Scheduler tick fires.
2. Collector fans out to every active adapter (mock or real) concurrently, bounded to `N` in flight.
3. Each adapter returns `[]SiteData` already normalized to the unified model.
4. Storage upserts current status into `sites`/`site_status` and inserts rows into the `site_metrics` hypertable.
5. Alert engine evaluates rules against each site's recent window; new/resolved alerts are written to `alerts` and pushed over SSE.
6. Frontend's next poll (or the SSE push) picks up the new state; problem sites re-sort to the top automatically because the query is sorted server-side by severity-then-time.

## 5. Deployment

Single VPS, Docker Compose, three containers (db, backend, frontend) behind a reverse proxy (Nginx/Caddy) terminating TLS — see `docker-compose.yml`. Nightly `pg_dump` to local disk + off-site copy, 30-day retention, matches the brief's backup requirement.

## 6. Key design decisions (ADR summary)

| # | Decision | Rationale |
|---|---|---|
| 1 | Cloud-to-cloud only, no edge hardware | Matches "won't have" scope; lower install cost |
| 2 | Single installer account per brand | Simplifies credential rotation |
| 3 | 5-minute polling | Balances freshness vs. brand API rate limits |
| 4 | State-based alerting with cooldowns | Avoids alert fatigue from transient blips |
| 5 | Self-hosted JWT auth instead of Clerk | Keeps the tool actually self-hosted, no external SaaS dependency for an internal tool |
| 6 | Mock adapter as default | Makes the full product demoable/testable before real credentials exist |
| 7 | Go single binary backend | Cheap concurrency for fan-out polling, trivial deployment |
| 8 | Next.js + shadcn/ui frontend | Accessible, fast to build, matches brief |
| 9 | Adapter interface isolates brand quirks | Sosen scraper (or Ingecon once confirmed) drops in without touching core logic |
| 10 | Hardcoded Africa/Nairobi (EAT) daytime window | Single-country deployment; avoids timezone-DB complexity for no real benefit |
