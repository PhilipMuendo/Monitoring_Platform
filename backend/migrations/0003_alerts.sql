-- ============================================================
-- alerts — problem detection history + active-alert tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('offline', 'production_drop', 'fault', 'battery_issue')),
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    message         TEXT NOT NULL,
    details         JSONB,
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_site_created ON alerts (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_type_active ON alerts (site_id, type) WHERE resolved_at IS NULL;

-- ============================================================
-- audit_log — who changed what in the admin UI (site CRUD, ack actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    action      TEXT NOT NULL,          -- e.g. 'site.create', 'alert.acknowledge'
    entity_type TEXT NOT NULL,          -- 'site' | 'alert' | 'user'
    entity_id   UUID,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
