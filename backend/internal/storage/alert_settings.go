package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"solar-monitor/internal/models"
)

// AlertSettingsRepo reads and writes the single fleet-wide alert policy row.
type AlertSettingsRepo struct{ db *DB }

func NewAlertSettingsRepo(db *DB) *AlertSettingsRepo { return &AlertSettingsRepo{db: db} }

// Both the leading and the TRAILING newline are load-bearing. Without the
// trailing one, `SELECT`+alertSettingsColumns+`FROM ...` concatenates to
// "updated_byFROM alert_settings", which Postgres reads as a single column
// alias and a query with no FROM clause at all — and then reports the
// confusingly unrelated `column "production_drop_threshold_w" does not
// exist`, because with no table in scope the FIRST column is the first thing
// that fails to resolve. Do not "tidy" the blank edges away.
const alertSettingsColumns = `
	production_drop_threshold_w, production_recover_threshold_w,
	production_drop_window_seconds, production_drop_cooldown_seconds,
	production_edge_margin_seconds,
	offline_threshold_seconds, offline_cooldown_seconds,
	fault_cooldown_seconds,
	battery_window_seconds, battery_soc_threshold_pct,
	battery_soc_recover_pct, battery_cooldown_seconds,
	updated_at, updated_by
`

const loadAlertSettingsSQL = `SELECT` + alertSettingsColumns + `FROM alert_settings WHERE id = true`

// Load returns the current policy.
//
// Returns ErrNotFound if the row is missing. Callers at boot fall back to
// alertengine.DefaultConfig() rather than refusing to start: an alert policy
// that cannot be read is a reason to run on the built-in defaults and say so
// loudly, not a reason to leave a fleet uncollected.
func (r *AlertSettingsRepo) Load(ctx context.Context) (models.AlertSettings, error) {
	var s models.AlertSettings
	err := r.db.Pool.QueryRow(ctx, loadAlertSettingsSQL).Scan(
		&s.ProductionDropThresholdW, &s.ProductionRecoverThresholdW,
		&s.ProductionDropWindowSeconds, &s.ProductionDropCooldownSeconds,
		&s.ProductionEdgeMarginSeconds,
		&s.OfflineThresholdSeconds, &s.OfflineCooldownSeconds,
		&s.FaultCooldownSeconds,
		&s.BatteryWindowSeconds, &s.BatterySOCThresholdPct,
		&s.BatterySOCRecoverPct, &s.BatteryCooldownSeconds,
		&s.UpdatedAt, &s.UpdatedBy,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return s, ErrNotFound
		}
		return s, fmt.Errorf("load alert settings: %w", err)
	}
	return s, nil
}

// Save overwrites the policy and returns it as stored.
//
// An UPDATE, not an upsert: migration 0009 seeds the row, and the CHECK
// constraint makes a second one impossible. If the row is somehow absent,
// failing here is correct — silently inserting would hide the fact that the
// migration did not run.
func (r *AlertSettingsRepo) Save(ctx context.Context, s models.AlertSettings, actorID string) (models.AlertSettings, error) {
	var out models.AlertSettings
	err := r.db.Pool.QueryRow(ctx, `
		UPDATE alert_settings SET
			production_drop_threshold_w      = $1,
			production_recover_threshold_w   = $2,
			production_drop_window_seconds   = $3,
			production_drop_cooldown_seconds = $4,
			production_edge_margin_seconds   = $5,
			offline_threshold_seconds        = $6,
			offline_cooldown_seconds         = $7,
			fault_cooldown_seconds           = $8,
			battery_window_seconds           = $9,
			battery_soc_threshold_pct        = $10,
			battery_soc_recover_pct          = $11,
			battery_cooldown_seconds         = $12,
			updated_at                       = now(),
			updated_by                       = NULLIF($13, '')::uuid
		WHERE id = true
		RETURNING`+alertSettingsColumns,
		s.ProductionDropThresholdW, s.ProductionRecoverThresholdW,
		s.ProductionDropWindowSeconds, s.ProductionDropCooldownSeconds,
		s.ProductionEdgeMarginSeconds,
		s.OfflineThresholdSeconds, s.OfflineCooldownSeconds,
		s.FaultCooldownSeconds,
		s.BatteryWindowSeconds, s.BatterySOCThresholdPct,
		s.BatterySOCRecoverPct, s.BatteryCooldownSeconds,
		actorID,
	).Scan(
		&out.ProductionDropThresholdW, &out.ProductionRecoverThresholdW,
		&out.ProductionDropWindowSeconds, &out.ProductionDropCooldownSeconds,
		&out.ProductionEdgeMarginSeconds,
		&out.OfflineThresholdSeconds, &out.OfflineCooldownSeconds,
		&out.FaultCooldownSeconds,
		&out.BatteryWindowSeconds, &out.BatterySOCThresholdPct,
		&out.BatterySOCRecoverPct, &out.BatteryCooldownSeconds,
		&out.UpdatedAt, &out.UpdatedBy,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return out, ErrNotFound
		}
		return out, fmt.Errorf("save alert settings: %w", err)
	}
	return out, nil
}
