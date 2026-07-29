package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"solar-monitor/internal/models"
)

// InTx runs fn inside a transaction, rolling back on error or panic.
//
// The rollback is deferred rather than written on each error path because a
// panic mid-transaction would otherwise leak the connection back to the
// pool with an open transaction on it, and the next borrower would inherit
// it. Rolling back an already-committed transaction is a no-op, so the
// happy path is unaffected.
func (d *DB) InTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// ReadingStore writes one poll result atomically.
//
// site_status (the dashboard's "latest known value") and site_metrics (the
// history series) are two representations of the same observation, and they
// were previously written as two independent statements. A crash or a
// connection drop between them left the dashboard showing a reading that
// has no corresponding row in the history — the charts and the site card
// disagreeing about what happened, with nothing to indicate which was
// right. One transaction makes them succeed or fail together.
type ReadingStore struct {
	db *DB
}

func NewReadingStore(db *DB) *ReadingStore { return &ReadingStore{db: db} }

// Record writes the reading to both site_status and site_metrics in a
// single transaction.
func (s *ReadingStore) Record(ctx context.Context, siteID string, d models.SiteData) error {
	raw := d.Raw
	if len(raw) == 0 {
		raw, _ = json.Marshal(d)
	}

	return s.db.InTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, upsertStatusSQL,
			siteID, string(d.Status), d.Power, d.EnergyToday, d.EnergyTotal, d.SOC,
			d.BatteryV, d.BatteryI, d.GridPower, d.LoadPower, d.FaultCode, d.Timestamp,
		); err != nil {
			return fmt.Errorf("upsert site status: %w", err)
		}

		if _, err := tx.Exec(ctx, insertMetricSQL,
			d.Timestamp, siteID, d.Power, d.EnergyToday, d.EnergyTotal, d.SOC,
			d.BatteryV, d.BatteryI, d.GridPower, d.LoadPower, d.FaultCode,
			string(d.Status), raw,
		); err != nil {
			return fmt.Errorf("insert metric: %w", err)
		}
		return nil
	})
}

// RecordStatusOnly writes site_status without appending to the history
// series.
//
// Used for StatusUnknown cycles: the dashboard should show that we've lost
// contact with a site, but a failed read is not an observation and must not
// become a data point. Writing it as a metric would put a phantom zero into
// every chart and into the production-drop rule's window.
//
// last_seen_at is deliberately left untouched here — it means "when did we
// last successfully read this site", so a failed poll must not refresh it.
func (s *ReadingStore) RecordStatusOnly(ctx context.Context, siteID string, status models.Status) error {
	_, err := s.db.Pool.Exec(ctx, `
		INSERT INTO site_status (site_id, status, last_seen_at)
		VALUES ($1::uuid, $2, NULL)
		ON CONFLICT (site_id) DO UPDATE SET
			status     = EXCLUDED.status,
			updated_at = NOW()
	`, siteID, string(status))
	if err != nil {
		return fmt.Errorf("upsert site status (%s): %w", status, err)
	}
	return nil
}
