package storage

import (
	"context"
	"fmt"
	"time"

	"solar-monitor/internal/models"
)

type MetricsRepo struct{ db *DB }

func NewMetricsRepo(db *DB) *MetricsRepo { return &MetricsRepo{db: db} }

// insertMetricSQL appends one reading to the site_metrics hypertable.
// Executed by ReadingStore inside the same transaction as the site_status
// upsert, so the dashboard's latest value and the history series can never
// disagree about what was observed.
//
// ON CONFLICT (site_id, time) DO UPDATE rather than a plain INSERT: a
// vendor whose sampling cadence is slower than POLL_INTERVAL re-serves the
// same timestamp on consecutive cycles, and a plain insert would land a
// duplicate row for it every time, skewing the hourly averages behind the
// 7d/30d charts. The upsert makes a repeated cycle idempotent instead —
// the row just gets refreshed with (identical) data.
const insertMetricSQL = `
	INSERT INTO site_metrics (
		time, site_id, power_w, energy_today_kwh, energy_total_kwh, soc,
		battery_voltage, battery_current, grid_power_w, load_power_w,
		fault_code, status, raw_data
	) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	ON CONFLICT (site_id, time) DO UPDATE SET
		power_w          = EXCLUDED.power_w,
		energy_today_kwh = EXCLUDED.energy_today_kwh,
		energy_total_kwh = EXCLUDED.energy_total_kwh,
		soc              = EXCLUDED.soc,
		battery_voltage  = EXCLUDED.battery_voltage,
		battery_current  = EXCLUDED.battery_current,
		grid_power_w     = EXCLUDED.grid_power_w,
		load_power_w     = EXCLUDED.load_power_w,
		fault_code       = EXCLUDED.fault_code,
		status           = EXCLUDED.status,
		raw_data         = EXCLUDED.raw_data
`

type PowerPoint struct {
	Time      time.Time `json:"time"`
	PowerW    *float64  `json:"power_w"`
	LoadW     *float64  `json:"load_w"`
	GridW     *float64  `json:"grid_w"`
	SOC       *float64  `json:"soc"`
	EnergyKWh *float64  `json:"energy_today_kwh"`
}

// History24h returns raw 5-minute readings for the last 24 hours —
// fine-grained enough to be meaningful at that resolution.
func (r *MetricsRepo) History24h(ctx context.Context, siteID string) ([]PowerPoint, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT time, power_w, load_power_w, grid_power_w, soc, energy_today_kwh
		FROM site_metrics
		WHERE site_id = $1::uuid AND time > NOW() - INTERVAL '24 hours'
		ORDER BY time ASC
	`, siteID)
	if err != nil {
		return nil, fmt.Errorf("history 24h: %w", err)
	}
	defer rows.Close()
	return scanPowerPoints(rows)
}

// HistoryHourly returns hourly-averaged points from the continuous
// aggregate for the 7-day and 30-day chart views, so we never scan raw
// 5-minute rows for a long window.
func (r *MetricsRepo) HistoryHourly(ctx context.Context, siteID string, since time.Duration) ([]PowerPoint, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT bucket, avg_power_w, avg_load_power_w, avg_grid_power_w, avg_soc, energy_today_kwh
		FROM site_metrics_hourly
		WHERE site_id = $1::uuid AND bucket > NOW() - $2::interval
		ORDER BY bucket ASC
	`, siteID, fmt.Sprintf("%d seconds", int(since.Seconds())))
	if err != nil {
		return nil, fmt.Errorf("history hourly: %w", err)
	}
	defer rows.Close()
	return scanPowerPoints(rows)
}

func scanPowerPoints(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]PowerPoint, error) {
	var out []PowerPoint
	for rows.Next() {
		var p PowerPoint
		if err := rows.Scan(&p.Time, &p.PowerW, &p.LoadW, &p.GridW, &p.SOC, &p.EnergyKWh); err != nil {
			return nil, fmt.Errorf("scan power point: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RecentReadings returns the last n raw readings for a site, newest
// first — used by the alert engine's consecutive-reading rules.
func (r *MetricsRepo) RecentReadings(ctx context.Context, siteID string, n int) ([]models.SiteData, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT time, power_w, energy_today_kwh, energy_total_kwh, soc,
			battery_voltage, battery_current, grid_power_w, load_power_w, fault_code, status
		FROM site_metrics
		WHERE site_id = $1::uuid
		ORDER BY time DESC
		LIMIT $2
	`, siteID, n)
	if err != nil {
		return nil, fmt.Errorf("recent readings: %w", err)
	}
	defer rows.Close()

	var out []models.SiteData
	for rows.Next() {
		var d models.SiteData
		var status string
		if err := rows.Scan(&d.Timestamp, &d.Power, &d.EnergyToday, &d.EnergyTotal, &d.SOC,
			&d.BatteryV, &d.BatteryI, &d.GridPower, &d.LoadPower, &d.FaultCode, &status); err != nil {
			return nil, fmt.Errorf("scan reading: %w", err)
		}
		d.Status = models.Status(status)
		out = append(out, d)
	}
	return out, rows.Err()
}
