-- ============================================================
-- site_metrics — 5-minute-granularity time-series (TimescaleDB hypertable)
-- ============================================================
CREATE TABLE IF NOT EXISTS site_metrics (
    time              TIMESTAMPTZ NOT NULL,
    site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    power_w           DOUBLE PRECISION,
    energy_today_kwh  DOUBLE PRECISION,
    energy_total_kwh  DOUBLE PRECISION,
    soc               DOUBLE PRECISION,
    battery_voltage   DOUBLE PRECISION,
    battery_current   DOUBLE PRECISION,
    grid_power_w      DOUBLE PRECISION,
    load_power_w      DOUBLE PRECISION,
    fault_code        INT,
    status            TEXT NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'warning', 'error')),
    raw_data          JSONB
);

-- 7-day chunks per the brief; ~50 sites x 288 readings/day is tiny per chunk
SELECT create_hypertable(
    'site_metrics', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_metrics_site_time ON site_metrics (site_id, time DESC);

-- Compress chunks older than 30 days, segmented by site for fast per-site scans
ALTER TABLE site_metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('site_metrics', INTERVAL '30 days', if_not_exists => TRUE);

-- Drop raw readings after 1 year to bound storage growth; aggregated history
-- lives in the continuous aggregates below indefinitely.
SELECT add_retention_policy('site_metrics', INTERVAL '365 days', if_not_exists => TRUE);

-- ============================================================
-- Continuous aggregates for the 7d / 30d power curve views —
-- pre-rolled hourly averages so a 30-day chart doesn't scan 8,640
-- raw rows per site on every request.
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS site_metrics_hourly
WITH (timescaledb.continuous) AS
SELECT
    site_id,
    time_bucket('1 hour', time)  AS bucket,
    AVG(power_w)                 AS avg_power_w,
    MAX(power_w)                 AS max_power_w,
    AVG(load_power_w)            AS avg_load_power_w,
    AVG(grid_power_w)            AS avg_grid_power_w,
    AVG(soc)                     AS avg_soc,
    MAX(energy_today_kwh)        AS energy_today_kwh
FROM site_metrics
GROUP BY site_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('site_metrics_hourly',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);
