-- ============================================================
-- Operator-editable alert thresholds.
--
-- Until now every value in alertengine.DefaultConfig() was a compile-time
-- constant, so tuning a threshold meant a code change and a redeploy. These
-- are exactly the numbers that need adjusting against a real fleet — how many
-- watts counts as "underproducing", how long a battery may sit low before
-- anyone is told — and the people who know the right answer are the operators,
-- not whoever is holding the repository.
--
-- WINDOWS ARE STORED AS DURATIONS, NOT READING COUNTS.
--
-- This is the important part of the schema and the reason the columns are
-- named the way they are. In code the production and battery windows are
-- counts of consecutive readings (6 and 3), which only mean anything alongside
-- POLL_INTERVAL: 6 readings is "half an hour" at the default 5 minutes and
-- "twelve minutes" at two. So the alert rule's actual sensitivity moved
-- whenever the poll interval was retuned, silently and with no mention of
-- alerting in that change. That coupling put a bug in production once already
-- — a window shorter than a passing cloud, which is what the 2 -> 6 change in
-- DefaultConfig was fixing.
--
-- Storing seconds breaks the coupling at the point where a human states their
-- intent. "Thirty minutes of low output" stays thirty minutes; the conversion
-- back to a reading count happens at load time against whatever POLL_INTERVAL
-- is in force. See AlertSettings.ToConfig in internal/models.
--
-- SINGLE ROW. The `id boolean PRIMARY KEY DEFAULT true CHECK (id)` idiom makes
-- a second row impossible at the schema level rather than by convention: there
-- is exactly one fleet-wide alert policy, and a table that permits two invites
-- the question of which one is live.
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_settings (
    id                               boolean PRIMARY KEY DEFAULT true CHECK (id),

    -- Production drop. The recover threshold is deliberately well above the
    -- fire threshold: that gap IS the hysteresis band, and a band narrower
    -- than the noise damps nothing. Enforced in application validation.
    production_drop_threshold_w      double precision NOT NULL,
    production_recover_threshold_w   double precision NOT NULL,
    production_drop_window_seconds   integer NOT NULL,
    production_drop_cooldown_seconds integer NOT NULL,
    -- How much of dawn and dusk is excluded from judgement. Output legitimately
    -- crosses any low threshold twice a day; alerting on sunrise is alerting on
    -- the system working.
    production_edge_margin_seconds   integer NOT NULL,

    offline_threshold_seconds        integer NOT NULL,
    offline_cooldown_seconds         integer NOT NULL,

    fault_cooldown_seconds           integer NOT NULL,

    battery_window_seconds           integer NOT NULL,
    battery_soc_threshold_pct        double precision NOT NULL,
    battery_soc_recover_pct          double precision NOT NULL,
    battery_cooldown_seconds         integer NOT NULL,

    updated_at                       timestamptz NOT NULL DEFAULT now(),
    -- ON DELETE SET NULL, not CASCADE: removing a user must never delete the
    -- fleet's alert policy. Losing the attribution is acceptable; losing the
    -- thresholds is not.
    updated_by                       uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Seed with the values alertengine.DefaultConfig() has been running, so
-- applying this migration changes no behaviour whatsoever. Windows are the
-- duration those reading counts represented at the default POLL_INTERVAL=5m:
-- production 6 readings = 1800s, battery 3 readings = 900s.
INSERT INTO alert_settings (
    id,
    production_drop_threshold_w, production_recover_threshold_w,
    production_drop_window_seconds, production_drop_cooldown_seconds,
    production_edge_margin_seconds,
    offline_threshold_seconds, offline_cooldown_seconds,
    fault_cooldown_seconds,
    battery_window_seconds, battery_soc_threshold_pct,
    battery_soc_recover_pct, battery_cooldown_seconds
) VALUES (
    true,
    50, 150,
    1800, 7200,
    3600,
    600, 3600,
    3600,
    900, 20,
    30, 7200
) ON CONFLICT (id) DO NOTHING;
