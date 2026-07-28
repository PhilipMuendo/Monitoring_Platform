# Database Schema

PostgreSQL 15 + TimescaleDB. Migrations live in `backend/migrations/*.sql`, applied in filename order by the backend's built-in migration runner on boot (`internal/storage/migrate.go`) — no external migration tool required.

## Entity overview

```
users ──< refresh_tokens
users ──< alerts (acknowledged_by)
users ──< audit_log

sites ──< site_status (1:1, latest snapshot)
sites ──< site_metrics (1:N, hypertable, 5-min granularity)
sites ──< alerts (1:N)
```

## Tables

### `users`
Staff accounts. `role` is one of `admin | technician | viewer`, enforced by a `CHECK` constraint and re-checked in API middleware. Passwords are bcrypt hashes, never plaintext.

### `refresh_tokens`
Hashed (SHA-256) refresh tokens for JWT rotation. A row is deleted/marked `revoked_at` on logout or rotation, so a leaked refresh token has a bounded lifetime (`expires_at`) even if never explicitly revoked.

### `sites`
Inventory of the 50+ monitored installations. `UNIQUE(brand, brand_site_id)` prevents the same remote site from being registered twice under one brand. `capacity_kw` and lat/long support future map/reporting views.

### `site_status`
One row per site holding the **latest known reading** — this is what the dashboard's site grid queries on every poll. Kept separate from the hypertable deliberately: "current status of 50 sites" is a hot, frequent, small read and shouldn't compete with time-series ingestion or require a `DISTINCT ON` over a hypertable.

### `site_metrics` (hypertable)
The full 5-minute-resolution history, chunked weekly. Compressed (segmented by `site_id`) after 30 days, and pruned after 365 days via a retention policy — bounded disk growth on a $15–30/mo VPS. `raw_data JSONB` retains the brand's original payload for debugging/reprocessing without needing to re-poll.

### `site_metrics_hourly` (continuous aggregate)
Hourly rollups maintained automatically by TimescaleDB. The 7-day and 30-day power-curve views query this instead of raw `site_metrics`, so a 30-day chart is ~720 rows/site instead of ~8,640.

### `alerts`
One row per detected problem. `resolved_at IS NULL` means "still active" (indexed as a partial index for the issues panel's hot query). `acknowledged*` columns track who dismissed it and when, independent of resolution — an alert can be acknowledged while still active.

### `audit_log`
Lightweight trail of admin actions (site added/edited/deactivated, alert acknowledged) for accountability in a multi-user tool.

## Indexing rationale

| Index | Serves |
|---|---|
| `idx_metrics_site_time` | Per-site historical chart queries (`WHERE site_id = ? ORDER BY time DESC`) |
| `idx_alerts_active` (partial) | "Show all active alerts" issues panel — scans only unresolved rows |
| `idx_alerts_type_active` | Alert engine's own "is there already an active alert of this type for this site" cooldown check |
| `idx_sites_active` (partial) | Collector's "which sites should I poll" query |
