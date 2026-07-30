-- ============================================================
-- Enforce one row per (site_id, time).
--
-- The collector can produce more than one reading for the same vendor
-- timestamp: a vendor whose own sampling cadence is slower than
-- POLL_INTERVAL (e.g. Ingecon updating every 15m against a 5m poll, or a
-- Deye board whose LastUpdateTime has stalled) re-serves the same
-- timestamp on consecutive cycles, and every one of those was landing as a
-- fresh row under the old non-unique index. That inflates the hourly
-- AVG() in site_metrics_hourly with repeated samples and silently skews
-- the 7d/30d power curves.
--
-- Existing duplicates are collapsed first so the unique index creation
-- doesn't fail against data already in the table.
-- ============================================================

DELETE FROM site_metrics a
USING site_metrics b
WHERE a.site_id = b.site_id
  AND a.time = b.time
  AND a.ctid < b.ctid;

-- Supersedes idx_metrics_site_time: same column order (so the existing
-- ORDER BY time DESC queries still use it as an index-only scan), now
-- unique so ON CONFLICT (site_id, time) in the collector's write path has
-- a target and duplicate cycles update the existing row instead of
-- inserting a new one.
DROP INDEX IF EXISTS idx_metrics_site_time;
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_site_time ON site_metrics (site_id, time DESC);
