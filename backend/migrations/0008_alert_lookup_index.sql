-- ============================================================
-- The alert engine's hottest query had no usable index.
--
-- evaluateRule calls LatestByTypeForSite once per rule per site per cycle
-- (offline, fault, production_drop, battery — four rules), so at 100 sites
-- that is 400 executions every collection cycle. The query is:
--
--     WHERE site_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT 1
--
-- Neither existing index serves it:
--
--   idx_alerts_site_created (site_id, created_at DESC)
--       Matches only the first column usable here, so the planner reads
--       EVERY alert row for the site, applies type as a post-filter, then
--       sorts. Confirmed on live data: "Rows Removed by Filter: 3" with a
--       separate Sort node above a bitmap scan.
--
--   idx_alerts_type_active (site_id, type) WHERE resolved_at IS NULL
--       Partial, and this query deliberately has no resolved_at filter — it
--       needs the latest alert of the type whether or not it was resolved,
--       because that is what the cooldown window is measured from. A partial
--       index cannot answer a query that does not carry its predicate.
--
-- Alerts are never deleted, only resolved, so this table only grows. The
-- cost per execution grows with a site's entire alert history rather than
-- staying constant, which is the shape of problem that stays invisible in
-- development and appears months into production.
--
-- With (site_id, type, created_at DESC) the planner walks straight to the
-- first matching row: no filter, no sort, one index fetch.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_alerts_site_type_created
    ON alerts (site_id, type, created_at DESC);

-- idx_alerts_type_active is now redundant for lookups: any query it could
-- serve, the new index serves too (it is a strict prefix extension, and the
-- partial predicate only narrows rows rather than adding a column). Dropped
-- so writes maintain one fewer index — alerts are written on every rule
-- transition across the whole fleet.
DROP INDEX IF EXISTS idx_alerts_type_active;
