package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"solar-monitor/internal/models"
)

type AlertRepo struct{ db *DB }

func NewAlertRepo(db *DB) *AlertRepo { return &AlertRepo{db: db} }

const alertSelect = `
	SELECT a.id::text, a.site_id::text, s.name, s.brand, a.type, a.severity, a.message,
		a.details, a.acknowledged, a.acknowledged_by::text, a.acknowledged_at, a.created_at, a.resolved_at
	FROM alerts a
	JOIN sites s ON s.id = a.site_id
`

func scanAlert(row pgx.Row) (models.Alert, error) {
	var a models.Alert
	var ackBy *string
	err := row.Scan(&a.ID, &a.SiteID, &a.SiteName, &a.Brand, &a.Type, &a.Severity, &a.Message,
		&a.Details, &a.Acknowledged, &ackBy, &a.AcknowledgedAt, &a.CreatedAt, &a.ResolvedAt)
	a.AcknowledgedBy = ackBy
	return a, err
}

// LatestByTypeForSite backs the alert engine's dedup/cooldown check: if
// the most recent alert of this type for this site is still unresolved,
// there's nothing new to do; if it was resolved recently, we're still in
// its cooldown window and shouldn't re-fire yet.
func (r *AlertRepo) LatestByTypeForSite(ctx context.Context, siteID string, alertType models.AlertType) (*models.Alert, error) {
	row := r.db.Pool.QueryRow(ctx, alertSelect+`
		WHERE a.site_id = $1::uuid AND a.type = $2
		ORDER BY a.created_at DESC LIMIT 1
	`, siteID, string(alertType))
	a, err := scanAlert(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}

func (r *AlertRepo) Create(ctx context.Context, siteID string, alertType models.AlertType, severity models.Severity, message string, details any) (models.Alert, error) {
	detailsJSON, _ := json.Marshal(details)
	var id string
	err := r.db.Pool.QueryRow(ctx, `
		INSERT INTO alerts (site_id, type, severity, message, details)
		VALUES ($1::uuid, $2, $3, $4, $5)
		RETURNING id::text
	`, siteID, string(alertType), string(severity), message, detailsJSON).Scan(&id)
	if err != nil {
		return models.Alert{}, fmt.Errorf("create alert: %w", err)
	}

	row := r.db.Pool.QueryRow(ctx, alertSelect+` WHERE a.id = $1::uuid`, id)
	return scanAlert(row)
}

// Resolve marks the alert closed (condition cleared) without requiring
// human acknowledgement.
func (r *AlertRepo) Resolve(ctx context.Context, id string) error {
	_, err := r.db.Pool.Exec(ctx, `UPDATE alerts SET resolved_at = NOW() WHERE id = $1::uuid AND resolved_at IS NULL`, id)
	return err
}

// Acknowledge both records who dismissed the alert and closes it. Per the
// brief, critical alerts (offline/fault) are "active until acknowledged" —
// so acknowledgement is the human action that resolves them; warning
// alerts (production drop/battery) usually auto-resolve on their own
// before anyone needs to click anything, but can also be acknowledged early.
func (r *AlertRepo) Acknowledge(ctx context.Context, id, userID string) (models.Alert, error) {
	_, err := r.db.Pool.Exec(ctx, `
		UPDATE alerts SET acknowledged = TRUE, acknowledged_by = $2::uuid, acknowledged_at = NOW(),
			resolved_at = COALESCE(resolved_at, NOW())
		WHERE id = $1::uuid
	`, id, userID)
	if err != nil {
		return models.Alert{}, fmt.Errorf("acknowledge alert: %w", err)
	}
	row := r.db.Pool.QueryRow(ctx, alertSelect+` WHERE a.id = $1::uuid`, id)
	a, err := scanAlert(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Alert{}, ErrNotFound
		}
		return models.Alert{}, err
	}
	return a, nil
}

// activeAlertsCap bounds ListActive. "Active" is normally small (bounded
// by fleet size), but a stuck resolution path or a misbehaving vendor
// feed firing the same rule in a loop could otherwise grow this query
// unbounded — unlike ListForSite, which already takes a limit.
const activeAlertsCap = 500

// ListActive returns every unresolved alert, most severe and most recent
// first — exactly what the dashboard's "Issues" panel renders.
func (r *AlertRepo) ListActive(ctx context.Context) ([]models.Alert, error) {
	rows, err := r.db.Pool.Query(ctx, alertSelect+`
		WHERE a.resolved_at IS NULL
		ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.created_at DESC
		LIMIT $1
	`, activeAlertsCap)
	if err != nil {
		return nil, fmt.Errorf("list active alerts: %w", err)
	}
	defer rows.Close()
	return collectAlerts(rows)
}

func (r *AlertRepo) ListForSite(ctx context.Context, siteID string, limit int) ([]models.Alert, error) {
	rows, err := r.db.Pool.Query(ctx, alertSelect+`
		WHERE a.site_id = $1::uuid ORDER BY a.created_at DESC LIMIT $2
	`, siteID, limit)
	if err != nil {
		return nil, fmt.Errorf("list site alerts: %w", err)
	}
	defer rows.Close()
	return collectAlerts(rows)
}

func (r *AlertRepo) CountActive(ctx context.Context) (int, error) {
	var n int
	err := r.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL`).Scan(&n)
	return n, err
}

func (r *AlertRepo) CountSince(ctx context.Context, since time.Duration) (int, error) {
	var n int
	err := r.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM alerts WHERE created_at > NOW() - $1::interval`,
		fmt.Sprintf("%d seconds", int(since.Seconds())),
	).Scan(&n)
	return n, err
}

func collectAlerts(rows pgx.Rows) ([]models.Alert, error) {
	var out []models.Alert
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, fmt.Errorf("scan alert: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
