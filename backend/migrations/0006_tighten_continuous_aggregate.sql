-- ============================================================
-- site_metrics_hourly policy: was refreshing only [now-3d, now-1h] once an
-- hour, which meant the 7d/30d charts always trailed real-time by up to
-- two hours (one hour of end_offset plus up to one more waiting for the
-- next scheduled run), and any bucket that aged past the 3-day start_offset
-- before ever being materialized (a multi-day outage, a delayed backfill)
-- would never be picked up by the policy again.
--
-- Data volume here is tiny (~50 sites x 288 rows/day), so widening the
-- refresh window costs nothing worth optimizing for:
--   - end_offset 1h -> 20m: still comfortably behind POLL_INTERVAL so a
--     bucket isn't materialized before all its readings have landed.
--   - schedule_interval 1h -> 15m: shrinks the "how far behind can the
--     chart be right before a refresh" window from ~2h to ~35m.
--   - start_offset 3d -> 35d: covers the full 30d chart range, so a gap
--     left by an outage backfills automatically the next time the policy
--     runs, instead of needing a manual refresh_continuous_aggregate call.
-- ============================================================

SELECT remove_continuous_aggregate_policy('site_metrics_hourly', if_exists => TRUE);

SELECT add_continuous_aggregate_policy('site_metrics_hourly',
    start_offset => INTERVAL '35 days',
    end_offset   => INTERVAL '20 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);
