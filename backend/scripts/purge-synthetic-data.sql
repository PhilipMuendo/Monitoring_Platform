-- Empties every telemetry table, leaving the schema and all user accounts
-- intact.
--
-- Written when the mock adapter was removed. Synthetic readings land in
-- exactly the same tables real inverter data does — there is no column that
-- marks a row as generated — so deleting the mock *code* does not remove the
-- mock *rows*. The only way to guarantee the dashboard shows live data only
-- is to start these tables empty and let the collector refill them from the
-- brand APIs.
--
-- Safe to re-run. Deliberately does NOT touch users, refresh_tokens or
-- audit_log, so the seeded admin login and the audit trail survive.
--
--   docker exec -i solar-monitor-db psql -U solar_admin -d solar_monitor \
--     < backend/scripts/purge-synthetic-data.sql

BEGIN;

DELETE FROM alerts;
DELETE FROM site_metrics;
DELETE FROM site_status;
DELETE FROM sites;

COMMIT;

-- site_metrics_hourly is a materialized-only continuous aggregate, so the
-- DELETE above never reaches its already-materialized buckets and the 7d/30d
-- charts would keep serving the old rollups long after site_metrics is empty.
-- Refreshing the full range recomputes them from the now-empty hypertable.
-- Must run outside the transaction above — TimescaleDB refuses a refresh
-- inside one.
CALL refresh_continuous_aggregate('site_metrics_hourly', NULL, NULL);
