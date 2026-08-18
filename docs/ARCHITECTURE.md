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

### Two viewports, not one responsive layout

Every route except `/wall` is responsive down to a phone. `/wall` is not, and
that is a decision rather than an omission.

The wall display is a **kiosk view**: `h-screen`, `overflow-hidden`, no app
chrome, a rotation timer, and a four-column overview grid that only exists at
`xl`. Nothing about it degrades gracefully — below `xl` the grid collapses to
one column, which stacks the power-flow card above "Needs Attention" inside a
container that cannot scroll, so everything past the first card is simply
unreachable on a page whose whole premise is that nobody is standing there.

`WallSizeGate` (`components/layout/wall-size-gate.tsx`) therefore refuses to
render it below **1280 x 640**, and points the visitor at the dashboard, which
shows the same fleet data and *is* responsive. Two details matter:

- **It is a mount boundary, not a CSS one.** `hidden xl:block` would still
  mount the subtree: components run, effects fire, and dynamic `import()`s
  resolve. The phone would download the whole 3D scene in order to not show
  it. `useMediaQuery` (`hooks/use-media-query.ts`) gates the mount instead,
  and reports `false` during SSR so the expensive branch can never appear
  speculatively.
- **The height half is not redundant.** A phone in landscape is ~844 x 390:
  it passes any sane width test and has less vertical room than a calculator.

The "Wall display" button in the app header is hidden below `xl` with a plain
Tailwind class — that one *is* just a 40-byte anchor, and CSS is the right
tool when both branches are cheap. The gate remains the backstop for a
bookmark or a pasted URL.

#### What the wall tells you now

Four additions, all of which exist because the wall previously showed *state*
without showing *what to do about it*.

**Platform status, not just fleet status** (`lib/platform-status.ts`). On the
live fleet, 9 of 20 sites were rendering as offline. Nothing was wrong with 9
installations: one vendor's API was rejecting our TLS handshake and another had
not published the day's samples. From across a room that is indistinguishable
from half the fleet going dark — and it is the difference between phoning a
technician and phoning nobody. `/health` already reported per-brand
online/offline/**unknown**, where unknown means *we could not read this site*,
and the chat assistant was already prompted to use it; the wall was the one
surface that ignored it. It now renders **one** banner — a wall has no
scrollback and nobody standing at it, so competing warnings all fail to land —
picked by a tested precedence: database down, then collection stalled (which
explains every brand at once), then a specific vendor unreachable, then merely
ageing data. This replaced the old stale-data-only warning.

**A generation curve** (`lib/fleet-curve.ts`, `GET /api/v1/fleet/today`). The
wall showed what the fleet is producing *now* and how much it has produced in
*total*, and neither answers "has today gone normally?". A flat-topped curve is
a clear day, a jagged one is cloud, one that stops mid-morning is a fault.
Drawn as a hand-built SVG rather than with Recharts: the chart needs no
tooltips, legend, axes or interaction, and pulling ~100 KB gzipped onto the
wall to draw a filled shape would undo the payload work above. The path
arithmetic is pure and unit-tested, including that it **breaks the line across
a collection gap** rather than spanning it — a straight line through an outage
reads as "the fleet held steady" when in fact nothing was measured.

**Energy against yesterday at the same time.** Comparing today-so-far with
yesterday's *full* total is the classic way a dashboard lies: at 09:00 it
reports "-85%" every morning on a perfectly healthy fleet, and drifts back to
zero by evening. A figure that is alarming at breakfast and fine after lunch
teaches people to ignore it. The backend returns yesterday's energy up to the
same clock time, and the comparison is suppressed entirely when the baseline is
below 1 kWh, because before dawn the ratio explodes.

**How long, not just "offline"** (`lib/downtime.ts`). Twenty minutes is a flaky
link that fixes itself on the next cycle; three days is a truck roll. The list
rendered both identically, so it named the unhappy sites and said nothing about
which to deal with first — on a screen nobody can click, that ordering is the
only triage available. A site that has *never* reported is graded "unknown"
rather than worst, since it is usually one registered minutes ago.

The row count is also no longer a constant. It was 6, with rows set to
`flex-1 min-h-0`, which let a row shrink below its own two lines of content —
so on a panel shorter than the layout assumed, rows rendered *on top of each
other*. `useFittedRows` measures instead, which is the only answer that is
right on a 1080p panel, a 4K one, and a short window alike.

#### Running unattended

Two changes for a screen that stays on for years.

**Burn-in protection.** The layout creeps by ±6px over a 20-minute cycle
(`.wall-burn-in-shift`), so no border or heading occupies the same pixels
permanently. That is ~0.02 px/second — far below perceptible — which is why it
is deliberately *not* suppressed under `prefers-reduced-motion`, unlike the
scene loading sweep: disabling it would trade a hardware protection for an
accessibility fix to a problem that does not exist at that speed. Transform
only, so it composites and never triggers layout beside the WebGL canvas.

**After-hours dimming** (`lib/wall-ambient.ts`). Full brightness 07:00–19:00 in
**Kenya** — the wall hangs in the office it describes, so it follows the fleet
clock rather than the viewer's, the same axis the 3D scene uses. Outside those
hours a black overlay fades in over an hour to 40% and no further: the display
still has to be legible to whoever is on site out of hours, which is exactly
when an alert matters most. An overlay rather than a CSS `filter`, which would
push the whole subtree including the canvas through an extra compositing pass
every frame.

#### What the wall stopped showing

The wall used to run the dashboard's six-card `KpiRow` under its header. Every
card in it turned out to be a second copy of something already on the same
screen: solar output, grid flow and average battery are printed by the 3D
scene's own callouts (and by the 2D diagram's nodes when the scene is
unavailable); sites online is drawn in the scene's bottom-left corner and on
the 2D diagram's hub node; active issues is the count already badged on "Needs
Attention" a few centimetres to the right. The band was spending ~110 px of a
fixed-height screen to repeat the panel underneath it.

Only **energy today** appears nowhere else, so only energy today survived, and
it moved into the header's empty middle — dead space between the title and the
clock, tall enough to hold it for nothing. The scene's camera fit is
height-bound at wall proportions (`lib/scene-camera.ts`), so every pixel
recovered goes straight into how large the building renders.

Worth recording how the sites-online duplicate was found: not by reading the
source, where it is a `<div>` nested inside the scene component's own
container, but by querying the rendered page. Two of these overlaps were
invisible from the call site.

The dashboard keeps the full `KpiRow`: it scrolls, it has no wall-sized scene,
and it is the page people read from a desk rather than across a room.

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

- **860 KB — three.js + react-three-fiber + four drei helpers.** Behind
  `next/dynamic(ssr:false)` and only fetched when the 3D power-flow view is
  selected. The default view mode is 2D, so this is genuinely opt-in.
- **232 KB — `postprocessing` (the ambient-occlusion pass).** A *second*,
  nested lazy chunk (`scene/ambient-occlusion.tsx`). It used to be a static
  import inside the scene chunk above, rendered conditionally — which meant
  every WebGL1 device downloaded a library only the WebGL2 tier can execute,
  the wall display's TV foremost among them. Splitting it took the scene's
  own chunk from 1271 KB to 860 KB raw (372 KB to 230 KB gzipped), so the
  building now paints after 230 KB rather than 372 KB and the shading
  resolves into it a moment later. Loaded with `React.lazy` + `Suspense`
  rather than `next/dynamic`: this code is already inside an `ssr:false`
  boundary, and plain Suspense is what the r3f reconciler handles natively
  inside a `<Canvas>`.
- **360 KB — Recharts.** Lazy on the site detail route via
  `site-history-charts.tsx`. Both charts share **one** dynamic boundary
  deliberately: giving each its own duplicated Recharts into two chunks and
  grew the bundle to 3.3 MB.
The 3D scene ships **no model assets at all** — every object in it is built
procedurally at mount. It previously carried a 4 MB `car.glb` plus a ~750 KB
Draco decoder, more than three times the size of the scene chunk itself, for a
car rendering about 40 px wide; it also carried a CC BY attribution obligation
and was the most saturated thing on a panel whose job is to show four
colour-coded power flows. The loader (`scene/gltf-model.tsx`) and the
self-hosted decoders remain in the tree for the next asset that needs them, and
cost nothing while nothing imports them.

#### How the 3D view arrives

Opt-in does not make it fast for the people who opt in: ~860 KB of code is
still most of a second on a first visit. Three things shape that wait, all in
`hooks/use-scene-3d.ts` and
`components/dashboard/fleet-power-flow-view.tsx`:

1. **The 2D diagram holds the panel, not a skeleton.** Every number the 2D view
   draws comes from the fleet summary the page already has, so there is no
   reason to show an empty placeholder while WebGL downloads. The scene
   replaces it, with a short cross-fade, once its chunk resolves.
2. **The download starts above the auth gate.** `SceneWarmup`, mounted in
   `lib/providers.tsx` outside `AuthProvider`, calls `warmPowerFlowScene()`
   on mount. This was the largest single saving available, and it was pure
   serialisation rather than size: the dashboard and wall pages both sit
   behind `RequireAuth`, which renders a spinner until the auth refresh call
   returns, so the chain used to be

       boot JS -> POST /auth/refresh -> render page -> read localStorage
                -> start downloading 860 KB

   with a full network round trip in front of the biggest asset on the site,
   for a chunk of public static JavaScript that has nothing to do with who is
   signed in. Warming from above overlaps the two. `usePowerFlowViewMode`
   still kicks off on mode change, which is what covers a toggle *during* a
   session; by then it is normally already a no-op.

   What gets warmed is not unconditional, and the two cases are different in
   kind (`lib/scene-load-policy.ts`):

   - Stored preference **"3d"** — explicit intent. Fetch, vetoed only by a
     device with no WebGL at all.
   - **No stored preference** — a first visit. Fetch *speculatively*, at
     `requestIdleCallback`, and decline on Save-Data, on 2g/slow-2g, and
     below a 768 px viewport. A phone should not spend ~370 KB of a data
     plan on a guess, and at that width the scene's callouts collide with
     the building anyway.
   - Stored preference **"2d"** — they have seen the 3D view and turned it
     off. Downloading it anyway spends their bandwidth to contradict a
     decision they already made. Do nothing.

   The speculative branch is the only one that is a bet. It is there because
   the 3D view is heading for every site page, so the first reach for it
   should be instant on the devices where that is free. It is also the one
   branch that is safe to delete if that stops being true.
3. **The chunk landing is the scene being ready.** The one thing fetched
   after it — the ambient-occlusion pass — is deliberately not waited on: it
   sits behind `Suspense fallback={null}`, so the un-shaded building renders
   immediately and the shading resolves into it. Same principle the car model
   was handled under while it shipped (swap on the chunk, let the slow thing
   arrive behind a stand-in); removing the model removed that problem rather
   than the mechanism.

A device with no WebGL context never starts the download at all, and a chunk
that fails to fetch leaves the 2D view in place instead of tripping an error
boundary — both matter most on the wall display's TV browser.

#### One scene, every installation

The 3D renderer takes a `PowerFlowScene` — four flow legs, a state of charge,
and an optional caption — not a `FleetSummary`. That single change is what let
the same component serve the fleet overview and every site detail page without
a fork, and a fork is precisely how two views of the same telemetry start
disagreeing about which way the grid arrow points.

Both callers build that input from `lib/power-flow-model.ts`, the one tested
module that owns direction:

```ts
fleetPowerFlowScene(summary)   // total_power_w, total_grid_w, …
sitePowerFlowScene(site)       // power_w, grid_power_w, siteBatteryW(site)
```

**There is no per-site configuration anywhere.** Adding a site is adding a row;
the scene never learns it exists. Direction comes from each site's own readings
through `solarLeg` / `gridLeg` / `loadLeg` / `batteryLeg`, the same functions
the 2D diagrams already used.

**The cost does not scale with site count**, which is the fact that made this
viable at all. The scene is one lazily-loaded chunk shared by every route, so
the site page adds *zero* download on top of the dashboard — measured: the
chunk hash and its 225.6 KB gzipped size were byte-identical before and after.
What remains per visit is a WebGL context and a shader compile, and the 2D
diagram holds the panel through it, so the panel is never empty.

What that leaves as the real constraint is **WebGL contexts, not bytes**.
Browsers cap them (~16 in Chrome, often ≤4 on a Smart TV), so one canvas at a
time is fine and a canvas per site *card* would not be. A grid of thumbnails
would need drei's `<View>` — one canvas, N viewports — which is different work.

Absent stays absent throughout. A site that reports no channel renders an
inactive leg and an em dash, and a site with no state of charge draws the
battery track with **no fill at all** rather than a fill of zero, which would
read as a flat battery instead of an unknown one. Twelve of twenty sites report
no grid, so this is the common case, not the edge.

Below 768px the site page shows the 2D diagram instead. Not a capability limit
— the scene runs fine on a phone — but at that width the four callouts collide
with the building they point at. It is deliberately the same threshold the
prefetch policy uses, so there is no width at which the app downloads the scene
and then declines to draw it.

#### Installable, and offline

The app is a PWA: `src/app/manifest.ts`, `public/sw.js`, and an install banner
in `components/install-prompt.tsx`.

**What the service worker actually buys.** Next already serves `/_next/static`
with `immutable` and a one-year max-age, so a returning visitor was *already*
getting the 3D chunk from disk cache with no round trip. The worker does not
make that faster, and it is worth saying so plainly because "add a service
worker to make it fast" is a common way to add a caching layer and measure
nothing. What it adds is: the app opens with no network; the cache survives the
browser silently evicting its HTTP disk cache under storage pressure on a
phone; and installability, which Chrome will not grant without a fetch handler.

Three routing rules, each an answer to "what happens when this is stale?":

| Request | Strategy | Why |
|---|---|---|
| `/_next/static/*` | cache-first | content-hashed, so a hit can never be stale |
| `/icons`, `/images`, manifest | stale-while-revalidate | *not* hashed — cache-first would pin a replaced logo forever |
| navigations | network-first, cache fallback | an app shell is unversioned; serving a stale one after a deploy strands the user on JS requesting chunks that no longer exist |
| **`/api/*`, `/_next/data/*`** | **never cached** | a monitoring dashboard serving a cached fleet summary is worse than one showing an error, because a stale reading looks exactly like a fresh one |

Nothing is precached on install. Next's filenames carry content hashes that
change every build, so a hardcoded precache list is wrong the moment anyone
deploys — and precaching the ~226 KB scene would quietly override
`lib/scene-load-policy.ts`, which exists to *not* spend a phone's data plan on
a view it will not display. Everything is cached on first use instead.

**The install prompt cannot be opened automatically.** `beforeinstallprompt`
must be deferred and `.prompt()` called from a user gesture; calling it on
mount is ignored and burns the event. So the app shows *its own* banner
immediately and the native dialog opens on tap. iOS is a separate path — Safari
has never implemented the event and there is no API to trigger installation, so
an iPhone gets Share → Add to Home Screen as instructions rather than a button
that cannot work.

**Blocked in production today:** installability requires a secure context, and
this deployment has no TLS. The event never fires over plain HTTP, so the
banner renders nothing. It is not broken — it is correctly waiting for https.
Verified working against a production build on localhost, which *is* a secure
context: worker activated, 19 assets cached including the 860 KB scene chunk,
zero API responses cached, banner rendered.

#### Day, dusk and night

The scene lights itself from the clock **in Kenya**, not the viewer's: `day`,
`dusk` or `night` from `lib/time-of-day.ts`, resolved through the IANA zone
`Africa/Nairobi`. Someone opening the dashboard from another timezone should
see whether it is dark *at the installations* — a sunlit house beside a fleet
reporting zero solar output is the kind of quiet contradiction that makes a
monitoring product feel untrustworthy.

Fixed hour thresholds are a poor model of sunrise almost everywhere and a good
one here: Nairobi is 1.3° south, so sunrise and sunset move less than twenty
minutes across the whole year.

`SCENE_LIGHTING` in `lib/power-flow-colors.ts` is the single table of what each
phase changes. It is **almost entirely lighting** — the same white plaster
under a dim blue sky reads as dark blue-grey without swapping a single
material. The exceptions are the three sky colours (nothing lights them), the
overlay ink, and the accent variant: the flow colours switch from the `light`
set to the `dark` set at night, which is what those two variants were always
for. The compound's dusk-to-dawn security lighting is lit for `dusk` and
`night`.

This axis is independent of the app's light/dark theme, and deliberately so.
The theme is a preference about the UI; the phase is a fact about the sites. A
night scene inside a light-themed dashboard is correct.

