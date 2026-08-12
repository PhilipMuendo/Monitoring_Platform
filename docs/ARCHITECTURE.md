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
│  │            │   │  bounded conc.)│   │ Sosen         │   │             │ │
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
- **Ingecon**: real HTTPS client against the Ingecon Sun Monitor API (`X-API-KEY` header), dispatching per plant type (`pv` / `sc`) and throttled to the documented rate limit.
- **Sosen**: real HTTPS client against `pv.inteless.com` — the JSON API the Sosen/Inteless portal itself is built on. The brief assumed this brand would need browser-automation scraping; live inspection found a proper REST API, so no scraper exists or is needed.

All three are polled only when their credentials are present in the environment; an unconfigured brand is never registered with the collector. There is no mock or demo adapter — every row in `site_metrics` came from a real inverter portal.

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
2. Collector fans out to every configured brand adapter concurrently, bounded to `N` in flight.
3. Each adapter returns `[]SiteData` already normalized to the unified model.
4. Storage writes `site_status` and `site_metrics` in **one transaction** — they are two representations of the same observation, and a crash between them left the dashboard and the charts disagreeing with nothing to say which was right. A cycle that failed to read a site updates the status only: a failed read is not a data point, and recording one would push a phantom row into every chart and into the production-drop rule's window.
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
| 6a | `unknown` is a first-class status, distinct from `offline` | A failed vendor call says nothing about the site. Folding the two together meant one flaky HTTP request could raise a critical alert, which is the fastest route to an on-call rota that ignores this system. Nothing alerts on `unknown`, and an unreachable cycle never resolves an existing alert either |
| 6b | Retry, backoff and rate-limit handling live in one transport (`adapters/httpjson`) | Retry policy is a cross-cutting decision, not a per-brand one. Full jitter rather than fixed exponential, because lockstep backoff turns a brief vendor wobble into a self-inflicted thundering herd |
| 6c | Every telemetry channel is nullable | "The vendor did not report PV power" and "the array is producing 0 W" are different facts. Flattening them produced offline sites displaying a stale 1.6 kW, and would poison any performance-ratio maths |
| 6d | Adapters normalize power-flow sign to **+import / −export** before storage | The brands disagree: Deye and Ingecon are import-positive, Sosen reports grid draw as negative. Storing each vendor's native convention pushed the disagreement onto every reader — the dashboard drew Sosen arrows backwards and labelled a house running entirely off the grid as "exporting". Normalizing at the adapter boundary means one convention holds fleet-wide and the DB, API and UI never have to ask which brand a row came from. Adapters decode optional vendor fields into pointers so an **absent** key stays null rather than decoding to a `0` that 6c cannot distinguish from a measurement |
| 6 | Live inverter data only — no mock adapter, no history seeding | An operations tool is judged on whether its numbers are trustworthy; synthetic readings sitting in the same tables as real ones make "is this site actually down?" unanswerable. A fresh install shows empty charts until polling fills them, which is the honest state |
| 7 | Go single binary backend | Cheap concurrency for fan-out polling, trivial deployment |
| 8 | Next.js + shadcn/ui frontend | Accessible, fast to build, matches brief |
| 9 | Adapter interface isolates brand quirks | Sosen scraper (or Ingecon once confirmed) drops in without touching core logic |
| 10 | Hardcoded Africa/Nairobi (EAT) daytime window | Single-country deployment; avoids timezone-DB complexity for no real benefit |

## 7. Performance & scaling

### Where the time actually goes

A collection cycle is dominated by **vendor API round-trip latency**, not by
our own compute or by Postgres. Everything else is noise beside it:

| Stage | Work per cycle at 20 sites | At 100 sites |
|---|---|---|
| Vendor fetch | ~28 HTTP calls (Deye makes **two** per station) | ~140 calls |
| DB writes | 2 statements per reading | 200 statements |
| Alert evaluation | ~5 queries per site | ~500 queries |

Adapters used to fetch plants **one at a time**, which made a cycle O(sites) in
vendor latency. They now fetch with bounded concurrency
(`httpjson.MapBounded`, governed by `COLLECTOR_MAX_CONCURRENCY`). Measured
deterministically against a mock server with 40 ms per call, 12 Deye stations
at 2 calls each: **172 ms concurrent vs ~960 ms sequential**, a 5.6× reduction
at concurrency 6.

`COLLECTOR_MAX_CONCURRENCY` previously bounded only the database fan-out —
not the vendor fetch it claimed to bound — so the one knob an operator would
reach for to speed up collection had no effect on the part of the cycle that
takes the time. It now applies to both.

### Would 100 sites work?

**Yes, on the current single-VPS design, with headroom.** The limiting factor
is the vendor APIs, not this system.

- **Collection.** At concurrency 10, ~140 calls at ~1 s each is roughly 15–20 s
  per cycle against a 5-minute interval — about 6% duty. Even fully sequential
  it would fit; concurrency is what keeps the margin comfortable when a vendor
  is slow.
- **Database.** ~700 queries per cycle is ~2.3 queries/second average. Trivial.
  Raw metrics grow at ~100 sites × 288 readings/day ≈ 28.8k rows/day (~10.5M
  rows/year), which is exactly what TimescaleDB hypertables are for, and the
  7d/30d charts read the `site_metrics_hourly` continuous aggregate rather
  than raw rows.
- **API payloads.** `/sites` returns every site in one response: ~400 bytes per
  site, so ~40 KB at 100 sites. Fine — but it is unbounded and unpaginated, and
  that is the first thing that will need attention past a few hundred.
- **Frontend.** The dashboard grid renders a card per site. `SiteCard` is
  memoized on the fields it paints, so a 30-second poll re-renders only the
  sites whose telemetry actually moved, and search is debounced so typing does
  not refilter and repaint per keystroke.
- **Wall display.** The site grid pages at 20 tiles rather than shrinking rows
  (see `WALL_TILES_PER_PAGE`); 100 tiles in one fixed-height grid would be 20
  rows of ~40 px slivers. Its dwell scales with page count so every site is
  shown at least once per rotation.

### What breaks first, past ~100

Ranked by how soon it bites:

1. **`GET /sites` is unpaginated.** Every consumer fetches the whole fleet
   every 30 s. At 500+ sites this is the first thing to page or filter
   server-side.
2. **Sosen's plant list is capped at `limit=200`** in the query string. Past
   200 plants it silently truncates — a correctness bug, not a slow one.
3. **Vendor rate limits, not our throughput.** Ingecon documents 20 requests
   per minute and the adapter self-throttles to 15; at ~2 calls per plant that
   ceiling is reached around 7 Ingecon plants per minute, so a large Ingecon
   fleet is paced by the vendor regardless of our concurrency.
4. **Per-site `ResolveSite` query.** One lookup per reading per cycle to map a
   `brand_site_id` to an internal UUID. Cheap and correct, but it is a lookup
   of data that changes almost never — an obvious cache if cycle time ever
   matters more than simplicity.
5. **The collector is a single process.** Horizontal scaling would need cycle
   work partitioned by brand or site range, and the chat rate limiter (in
   memory, per process) would need shared backing.

### Indexing

`idx_alerts_site_type_created` (migration 0008) serves the alert engine's
hottest query — `WHERE site_id AND type ORDER BY created_at DESC LIMIT 1`,
run once per rule per site per cycle, i.e. ~400×/cycle at 100 sites. Before it,
neither existing index applied: one matched only `site_id`, and the other was
partial on `resolved_at IS NULL` which that query deliberately does not filter
on. The planner read every alert for the site, filtered by type, then sorted.
Alerts are never deleted, only resolved, so the cost grew with a site's entire
alert history rather than staying constant.

### Frontend bundle

2.9 MB of client JS total, but almost none of it is on any critical path:

- **1271 KB — three.js + postprocessing.** Behind `next/dynamic(ssr:false)`
  and only fetched when the 3D power-flow view is selected. The default view
  mode is 2D, so this is genuinely opt-in.
- **360 KB — Recharts.** Lazy on the site detail route via
  `site-history-charts.tsx`. Both charts share **one** dynamic boundary
  deliberately: giving each its own duplicated Recharts into two chunks and
  grew the bundle to 3.3 MB.
- **4 MB — `car.glb`.** Draco-compressed, loaded only inside the 3D scene.

