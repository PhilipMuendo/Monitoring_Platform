package storage

import (
	"context"
	"fmt"
	"time"
)

// FLEET DAY BOUNDARIES.
//
// EAT is UTC+3 all year — Kenya has never observed daylight saving — so a
// fixed zone is exact here and cannot fail. time.LoadLocation("Africa/Nairobi")
// would be the more general answer and is the wrong trade for this service:
// it reads the host tzdata, which a scratch or distroless container does not
// have, so it would work in development and return a UTC day in production.
// Embedding time/tzdata to fix that costs ~450 KB of binary for a deployment
// the config already documents as single-country (see DaytimeStartHour).
//
// This matters more than it looks. Every "today" on this dashboard has to mean
// the same day the inverters mean, because energy_today_kwh is a counter the
// VENDOR resets at ITS local midnight. Compute the day in UTC and between
// 21:00 and midnight Nairobi you would be summing two different days' counters
// and reporting the result as today.
var eat = time.FixedZone("EAT", 3*60*60)

// FleetDay is the local day containing t, as a half-open [start, end) range.
func FleetDay(t time.Time) (start, end time.Time) {
	local := t.In(eat)
	start = time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, eat)
	return start, start.AddDate(0, 0, 1)
}

// FleetPoint is one bucket of fleet-wide instantaneous generation.
type FleetPoint struct {
	Time   time.Time `json:"time"`
	PowerW float64   `json:"power_w"`
}

// FleetPowerCurve returns fleet-wide generation over [from, to), bucketed.
//
// The two-stage aggregation is not incidental. Sites do not share a clock:
// each vendor stamps its own sample times, and one site can land two readings
// in a bucket while another lands none. Summing raw rows per bucket would then
// count the busier site twice and read as a spike that never happened. So each
// site is averaged WITHIN a bucket first, and only those per-site averages are
// summed across the fleet — one value per site per bucket, whatever its
// reporting cadence.
//
// Sites with no reading in a bucket contribute nothing rather than zero. That
// is the honest choice for a curve labelled "generation": a site we failed to
// poll has not generated 0 W, we simply do not know, and drawing it as 0 turns
// our own collection gap into an apparent fleet-wide dip.
func (r *MetricsRepo) FleetPowerCurve(ctx context.Context, from, to time.Time, bucket time.Duration) ([]FleetPoint, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT b, SUM(site_avg)::double precision
		FROM (
			SELECT time_bucket($1::interval, m.time) AS b,
			       m.site_id,
			       AVG(m.power_w) AS site_avg
			FROM site_metrics m
			JOIN sites s ON s.id = m.site_id AND s.is_active
			WHERE m.time >= $2 AND m.time < $3 AND m.power_w IS NOT NULL
			GROUP BY b, m.site_id
		) per_site
		GROUP BY b
		ORDER BY b
	`, fmt.Sprintf("%d seconds", int(bucket.Seconds())), from, to)
	if err != nil {
		return nil, fmt.Errorf("fleet power curve: %w", err)
	}
	defer rows.Close()

	out := make([]FleetPoint, 0, 128)
	for rows.Next() {
		var p FleetPoint
		if err := rows.Scan(&p.Time, &p.PowerW); err != nil {
			return nil, fmt.Errorf("scan fleet point: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FleetEnergyKWh sums the fleet's generated energy over [from, to).
//
// energy_today_kwh is a CUMULATIVE per-site counter that the inverter resets
// at its local midnight, so the energy a site produced during a window is the
// highest value it reported inside that window — not a sum of the readings,
// which would add the same kilowatt-hours once per poll and report about 288
// times the truth at a 5-minute cadence.
//
// Correct only for windows that start at local midnight, which is exactly how
// it is used (today so far, yesterday to the same clock time, yesterday
// whole). A window starting mid-day would need max-minus-min instead; that is
// not computed here because nothing asks for it and a half-right helper is
// worse than an absent one.
func (r *MetricsRepo) FleetEnergyKWh(ctx context.Context, from, to time.Time) (float64, error) {
	var total float64
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(site_max), 0)::double precision
		FROM (
			SELECT MAX(m.energy_today_kwh) AS site_max
			FROM site_metrics m
			JOIN sites s ON s.id = m.site_id AND s.is_active
			WHERE m.time >= $1 AND m.time < $2 AND m.energy_today_kwh IS NOT NULL
			GROUP BY m.site_id
		) per_site
	`, from, to).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("fleet energy: %w", err)
	}
	return total, nil
}
