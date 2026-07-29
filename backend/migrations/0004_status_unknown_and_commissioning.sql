-- Adds the two non-observational site states.
--
-- Until now every site was online/offline/warning/error, which forced two
-- very different situations to borrow "offline":
--
--   * we could not reach the vendor's API this cycle (says nothing about
--     the site), and
--   * the site has been registered but has never reported at all.
--
-- Both were then escalated by the alert engine as genuine outages. A
-- single flaky HTTP call could page someone, and a site added at 16:00
-- alerted before anyone had finished wiring it up.
--
-- Idempotent, matching the other migrations here: the
-- docker-entrypoint-initdb.d path may have run them already.

-- 1. site_status: swap the CHECK for a widened one.
ALTER TABLE site_status DROP CONSTRAINT IF EXISTS site_status_status_check;
ALTER TABLE site_status
    ADD CONSTRAINT site_status_status_check
    CHECK (status IN ('online', 'offline', 'warning', 'error', 'unknown', 'commissioning'));

-- 2. site_metrics: drop the CHECK and do not replace it.
--
-- TimescaleDB refuses ALTER TABLE ... ADD CONSTRAINT on a hypertable with
-- compression enabled ("operation not supported on hypertables that have
-- compression enabled", SQLSTATE 0A000). Re-adding it would mean
-- decompressing every chunk, disabling compression, altering, re-enabling
-- and re-creating the retention policy — a long, destructive-if-interrupted
-- operation on the largest table in the database, repeated for every future
-- status value.
--
-- Dropping it is the better trade rather than merely the easier one:
-- site_metrics is append-only and written by exactly one code path (the
-- collector, via ReadingStore.Record), the values come from a closed Go
-- enum (models.Status) rather than user input, and a per-row CHECK on the
-- highest-volume table in the schema buys validation we already have at the
-- type level. site_status keeps its constraint — it is small, mutable, and
-- not compressed.
ALTER TABLE site_metrics DROP CONSTRAINT IF EXISTS site_metrics_status_check;

-- 3. last_seen_at must be nullable.
--
-- It means "when did we last successfully read this site". A site in
-- commissioning has never been read, and an unknown cycle must not refresh
-- it — so NULL is the honest value, not now().
ALTER TABLE site_status ALTER COLUMN last_seen_at DROP NOT NULL;

-- 4. Seed the state for sites that have never reported.
--
-- A site with a status row but no last_seen_at was never actually
-- observed; it was only ever assumed offline.
UPDATE site_status
   SET status = 'commissioning'
 WHERE last_seen_at IS NULL
   AND status = 'offline';

-- 5. Index supporting the collector's "mark this brand unknown" sweep,
--    which runs on every total fetch failure for a brand.
CREATE INDEX IF NOT EXISTS idx_sites_brand_active
    ON sites (brand) WHERE is_active;
