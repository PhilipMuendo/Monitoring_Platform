-- ============================================================
-- site_metrics_hourly was created with real-time aggregation off
-- (materialized_only = true), so the view returned *only* buckets the
-- refresh policy had already materialized. A 1-hour bucket is materialized
-- only once it has fully elapsed and cleared the 20-minute end_offset, so
-- the newest 1h-1h20m of readings were invisible to the 7d and 30d charts.
--
-- On a fresh database this is not a subtle lag, it is the whole chart: with
-- every reading collected inside the last hour, /history?range=7d returned
-- zero points and the site page rendered "No data for this period yet."
-- while the 24h view of the same site showed a live curve. A monitoring
-- tool reporting "no data" for a site that just reported is worse than a
-- slightly stale number.
--
-- Turning real-time aggregation on makes the view UNION its materialized
-- buckets with the not-yet-materialized raw rows at query time, so 7d/30d
-- reach right up to the latest reading. The cost is scanning the raw tail
-- on those queries, which is bounded by end_offset (~20 minutes of rows,
-- ~4 per site) - negligible next to the 8,640 rows/site the aggregate
-- exists to avoid scanning.
-- ============================================================

ALTER MATERIALIZED VIEW site_metrics_hourly
    SET (timescaledb.materialized_only = false);
