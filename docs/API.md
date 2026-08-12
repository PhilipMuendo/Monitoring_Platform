# API Reference

Base URL: `http://localhost:8080`. All `/api/v1/*` routes except `/auth/*` require `Authorization: Bearer <access_token>`.

## Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/login` | none | `{email, password}` → `{access_token, refresh_token, user}` |
| POST | `/api/v1/auth/refresh` | none | `{refresh_token}` → new token pair (old refresh token is revoked) |
| POST | `/api/v1/auth/logout` | none | `{refresh_token}` → revokes it |
| GET | `/api/v1/me` | any role | current user |

Access tokens are short-lived JWTs (15 min default). Refresh tokens are opaque, stored hashed, rotate on every use, default 30-day expiry.

## Fleet & sites

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/fleet/summary` | any role | Aggregate KPI numbers powering the dashboard's KPI cards + power-flow viz |
| GET | `/api/v1/sites` | any role | All sites + latest status, **problem sites sorted first** (`?all=true` includes inactive) |
| GET | `/api/v1/sites/{id}` | any role | Single site + latest status |
| GET | `/api/v1/sites/{id}/history?range=24h\|7d\|30d` | any role | Power-curve points (raw 5-min for 24h, hourly rollups for 7d/30d) |
| GET | `/api/v1/sites/{id}/alerts` | any role | Alert history for one site |

### Telemetry field conventions

These hold for `/sites`, `/sites/{id}` and the points in `/sites/{id}/history`.

**Sign.** `grid_power_w` is **positive when importing** from the grid and
negative when exporting. Adapters normalize to this before storage, so the
value never depends on which brand the site is (Sosen reports grid draw as
negative natively and is negated on the way in). A value of exactly `0` is
always `+0`.

**Null vs zero.** Every telemetry field is nullable and the two states mean
different things:

| Value | Meaning |
|---|---|
| a number | the portal reported this measurement |
| `null` / key absent | the portal did **not** report it — not a measured zero |

Clients must render null as "—" or similar, never coerce it to `0`. Real
cases in the current fleet: no Deye site reports `grid_power_w` or
`energy_total_kwh` at all, and two Sosen plants omit `gridPower` from their
realtime payload while the other six report it. Coercing produced a
confident "0 W importing" for sites where grid flow was simply never
measured.

`load_power_w` is derived from `grid_power_w` for Sosen, so it is null
wherever that is null rather than being guessed.

**Array fields are always arrays.** `points`, alert lists and the admin user
list serialize as `[]` when empty, never `null`, so clients can index and
check `.length` unconditionally.

## Alerts

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/alerts` | any role | All active (unresolved) alerts, critical-then-warning, newest first |
| POST | `/api/v1/alerts/{id}/acknowledge` | admin, technician | Acknowledges + closes the alert |
| GET | `/api/v1/alerts/stream` | any role (token via `?token=` or header) | SSE stream: `alert.created`, `alert.resolved`, `alert.acknowledged` |

## Admin (site & user management)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/admin/sites` | admin | Register a new site (`name, brand, brand_site_id, location, capacity_kw, ...`) |
| PATCH | `/api/v1/admin/sites/{id}` | admin | Partial update (rename, recapacity, activate/deactivate) |
| DELETE | `/api/v1/admin/sites/{id}` | admin | Remove a site (cascades its metrics/alerts) |
| GET | `/api/v1/admin/users` | admin | List staff accounts |
| POST | `/api/v1/admin/users` | admin | Create a staff account (`email, password, name, role`) |

## Operational

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | Detailed health JSON matching the brief's shape (collector stats, per-brand online/offline, alert counts) |
| GET | `/healthz` | none | Trivial liveness probe for container orchestration |

## Roles

`admin` — full access including site/user management. `technician` — view everything, acknowledge alerts. `viewer` — read-only.
