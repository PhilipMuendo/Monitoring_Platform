-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ============================================================
-- users — internal staff accounts (self-hosted auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('admin', 'technician', 'viewer')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- refresh_tokens — rotating refresh tokens for JWT auth
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ============================================================
-- sites — inventory of monitored installations
-- ============================================================
CREATE TABLE IF NOT EXISTS sites (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    brand                 TEXT NOT NULL CHECK (brand IN ('deye', 'ingecon', 'sosen')),
    brand_site_id         TEXT NOT NULL,       -- ID within the brand's own system
    location              TEXT,
    latitude              DECIMAL(10, 8),
    longitude             DECIMAL(11, 8),
    capacity_kw           DECIMAL(10, 2) NOT NULL DEFAULT 0,
    installer_account_id  TEXT,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand, brand_site_id)
);

CREATE INDEX IF NOT EXISTS idx_sites_brand ON sites (brand);
CREATE INDEX IF NOT EXISTS idx_sites_active ON sites (is_active) WHERE is_active;

-- ============================================================
-- site_status — latest known state per site (fast dashboard reads)
-- Kept separate from the metrics hypertable so "give me the current
-- status of all 50 sites" is a single small-table scan, not a
-- last-value-per-partition query over a hypertable.
-- ============================================================
CREATE TABLE IF NOT EXISTS site_status (
    site_id           UUID PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'offline'
                      CHECK (status IN ('online', 'offline', 'warning', 'error')),
    power_w           DOUBLE PRECISION,
    energy_today_kwh  DOUBLE PRECISION,
    energy_total_kwh  DOUBLE PRECISION,
    soc               DOUBLE PRECISION,
    battery_voltage   DOUBLE PRECISION,
    battery_current   DOUBLE PRECISION,
    grid_power_w      DOUBLE PRECISION,
    load_power_w      DOUBLE PRECISION,
    fault_code        INT,
    last_seen_at      TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at triggers -------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sites_updated_at ON sites;
CREATE TRIGGER trg_sites_updated_at BEFORE UPDATE ON sites
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
