package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/models"
)

var ErrNotFound = errors.New("not found")

type SiteRepo struct{ db *DB }

func NewSiteRepo(db *DB) *SiteRepo { return &SiteRepo{db: db} }

const siteWithStatusSelect = `
	SELECT
		s.id::text, s.name, s.brand, s.brand_site_id, s.location,
		s.latitude, s.longitude, s.capacity_kw, COALESCE(s.installer_account_id, ''),
		s.is_active, s.created_at, s.updated_at,
		COALESCE(st.status, 'offline') AS status,
		st.power_w, st.energy_today_kwh, st.energy_total_kwh, st.soc,
		st.battery_voltage, st.battery_current, st.grid_power_w, st.load_power_w,
		st.fault_code, st.last_seen_at
	FROM sites s
	LEFT JOIN site_status st ON st.site_id = s.id
`

// rankOrder makes problem sites rise to the top: error, then offline,
// then warning, then online — matching the brief's "problem sites
// automatically rise to the top" requirement.
const rankOrder = `
	ORDER BY CASE COALESCE(st.status, 'offline')
		WHEN 'error' THEN 0
		WHEN 'offline' THEN 1
		WHEN 'warning' THEN 2
		WHEN 'online' THEN 3
		ELSE 4
	END, s.name
`

func scanSiteWithStatus(row pgx.Row) (models.SiteWithStatus, error) {
	var s models.SiteWithStatus
	err := row.Scan(
		&s.ID, &s.Name, &s.Brand, &s.BrandSiteID, &s.Location,
		&s.Latitude, &s.Longitude, &s.CapacityKW, &s.InstallerAccountID,
		&s.IsActive, &s.CreatedAt, &s.UpdatedAt,
		&s.Status,
		&s.PowerW, &s.EnergyTodayKWh, &s.EnergyTotalKWh, &s.SOC,
		&s.BatteryVoltage, &s.BatteryCurrent, &s.GridPowerW, &s.LoadPowerW,
		&s.FaultCode, &s.LastSeenAt,
	)
	return s, err
}

func (r *SiteRepo) List(ctx context.Context, activeOnly bool) ([]models.SiteWithStatus, error) {
	query := siteWithStatusSelect
	if activeOnly {
		query += " WHERE s.is_active = TRUE "
	}
	query += rankOrder

	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list sites: %w", err)
	}
	defer rows.Close()

	var out []models.SiteWithStatus
	for rows.Next() {
		s, err := scanSiteWithStatus(rows)
		if err != nil {
			return nil, fmt.Errorf("scan site: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *SiteRepo) GetByID(ctx context.Context, id string) (*models.SiteWithStatus, error) {
	query := siteWithStatusSelect + " WHERE s.id = $1::uuid"
	row := r.db.Pool.QueryRow(ctx, query, id)
	s, err := scanSiteWithStatus(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get site: %w", err)
	}
	return &s, nil
}

// ResolveSite resolves the internal UUID + display name for a reading
// the collector just fetched. Returns ErrNotFound if no admin has
// registered this brand_site_id yet (and no describer auto-registered it).
func (r *SiteRepo) ResolveSite(ctx context.Context, brand models.Brand, brandSiteID string) (id string, name string, err error) {
	err = r.db.Pool.QueryRow(ctx,
		`SELECT id::text, name FROM sites WHERE brand = $1 AND brand_site_id = $2`,
		string(brand), brandSiteID,
	).Scan(&id, &name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", ErrNotFound
		}
		return "", "", err
	}
	return id, name, nil
}

type CreateSiteInput struct {
	Name               string
	Brand              models.Brand
	BrandSiteID        string
	Location           string
	Latitude           *float64
	Longitude          *float64
	CapacityKW         float64
	InstallerAccountID string
}

func (r *SiteRepo) Create(ctx context.Context, in CreateSiteInput) (*models.Site, error) {
	var s models.Site
	err := r.db.Pool.QueryRow(ctx, `
		INSERT INTO sites (name, brand, brand_site_id, location, latitude, longitude, capacity_kw, installer_account_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''))
		RETURNING id::text, name, brand, brand_site_id, location, latitude, longitude, capacity_kw,
			COALESCE(installer_account_id, ''), is_active, created_at, updated_at
	`, in.Name, string(in.Brand), in.BrandSiteID, in.Location, in.Latitude, in.Longitude, in.CapacityKW, in.InstallerAccountID,
	).Scan(&s.ID, &s.Name, &s.Brand, &s.BrandSiteID, &s.Location, &s.Latitude, &s.Longitude,
		&s.CapacityKW, &s.InstallerAccountID, &s.IsActive, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create site: %w", err)
	}
	return &s, nil
}

type UpdateSiteInput struct {
	Name        *string
	Location    *string
	Latitude    *float64
	Longitude   *float64
	CapacityKW  *float64
	IsActive    *bool
}

func (r *SiteRepo) Update(ctx context.Context, id string, in UpdateSiteInput) (*models.Site, error) {
	var s models.Site
	err := r.db.Pool.QueryRow(ctx, `
		UPDATE sites SET
			name        = COALESCE($2, name),
			location    = COALESCE($3, location),
			latitude    = COALESCE($4, latitude),
			longitude   = COALESCE($5, longitude),
			capacity_kw = COALESCE($6, capacity_kw),
			is_active   = COALESCE($7, is_active)
		WHERE id = $1::uuid
		RETURNING id::text, name, brand, brand_site_id, location, latitude, longitude, capacity_kw,
			COALESCE(installer_account_id, ''), is_active, created_at, updated_at
	`, id, in.Name, in.Location, in.Latitude, in.Longitude, in.CapacityKW, in.IsActive,
	).Scan(&s.ID, &s.Name, &s.Brand, &s.BrandSiteID, &s.Location, &s.Latitude, &s.Longitude,
		&s.CapacityKW, &s.InstallerAccountID, &s.IsActive, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update site: %w", err)
	}
	return &s, nil
}

func (r *SiteRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM sites WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("delete site: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpsertDiscovered registers a site auto-discovered via a brand's
// SiteDescriber, without clobbering any admin edits made since — only
// inserts when the (brand, brand_site_id) pair doesn't exist yet.
func (r *SiteRepo) UpsertDiscovered(ctx context.Context, brand models.Brand, d adapters.SiteDescriptor) error {
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO sites (name, brand, brand_site_id, location, capacity_kw)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (brand, brand_site_id) DO NOTHING
	`, d.Name, string(brand), d.BrandSiteID, d.Location, d.CapacityKW)
	if err != nil {
		return fmt.Errorf("upsert discovered site: %w", err)
	}
	return nil
}

// UpsertStatus writes the latest-known-reading row the dashboard reads on
// every poll. Called once per site per collection cycle.
func (r *SiteRepo) UpsertStatus(ctx context.Context, siteID string, d models.SiteData) error {
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO site_status (
			site_id, status, power_w, energy_today_kwh, energy_total_kwh, soc,
			battery_voltage, battery_current, grid_power_w, load_power_w, fault_code, last_seen_at
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (site_id) DO UPDATE SET
			status = EXCLUDED.status,
			power_w = EXCLUDED.power_w,
			energy_today_kwh = EXCLUDED.energy_today_kwh,
			energy_total_kwh = EXCLUDED.energy_total_kwh,
			soc = EXCLUDED.soc,
			battery_voltage = EXCLUDED.battery_voltage,
			battery_current = EXCLUDED.battery_current,
			grid_power_w = EXCLUDED.grid_power_w,
			load_power_w = EXCLUDED.load_power_w,
			fault_code = EXCLUDED.fault_code,
			last_seen_at = EXCLUDED.last_seen_at,
			updated_at = NOW()
	`, siteID, string(d.Status), d.Power, d.EnergyToday, d.EnergyTotal, d.SOC,
		d.BatteryV, d.BatteryI, d.GridPower, d.LoadPower, d.FaultCode, d.Timestamp)
	if err != nil {
		return fmt.Errorf("upsert site status: %w", err)
	}
	return nil
}

// FleetSummary powers the dashboard's KPI cards and power-flow visualization.
func (r *SiteRepo) FleetSummary(ctx context.Context) (models.FleetSummary, error) {
	var sum models.FleetSummary
	var oldestSeen *time.Time
	err := r.db.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE s.is_active),
			COUNT(*) FILTER (WHERE s.is_active AND COALESCE(st.status,'offline') = 'online'),
			COUNT(*) FILTER (WHERE s.is_active AND COALESCE(st.status,'offline') = 'offline'),
			COUNT(*) FILTER (WHERE s.is_active AND COALESCE(st.status,'offline') = 'warning'),
			COUNT(*) FILTER (WHERE s.is_active AND COALESCE(st.status,'offline') = 'error'),
			COALESCE(SUM(st.power_w) FILTER (WHERE s.is_active), 0),
			COALESCE(SUM(st.load_power_w) FILTER (WHERE s.is_active), 0),
			COALESCE(SUM(st.grid_power_w) FILTER (WHERE s.is_active), 0),
			COALESCE(AVG(st.soc) FILTER (WHERE s.is_active), 0),
			COALESCE(SUM(st.energy_today_kwh) FILTER (WHERE s.is_active), 0),
			MIN(st.last_seen_at) FILTER (WHERE s.is_active)
		FROM sites s
		LEFT JOIN site_status st ON st.site_id = s.id
	`).Scan(
		&sum.TotalSites, &sum.OnlineSites, &sum.OfflineSites, &sum.WarningSites, &sum.ErrorSites,
		&sum.TotalPowerW, &sum.TotalLoadW, &sum.TotalGridW, &sum.AvgSOC, &sum.EnergyTodayKWh,
		&oldestSeen,
	)
	if err != nil {
		return sum, fmt.Errorf("fleet summary: %w", err)
	}
	// Power balance: generation + grid import = load + battery charging
	// (grid negative = exporting, battery negative = discharging), so
	// battery = power + grid - load.
	sum.TotalBatteryW = sum.TotalPowerW + sum.TotalGridW - sum.TotalLoadW
	if oldestSeen != nil {
		sum.DataAgeSeconds = int(time.Since(*oldestSeen).Seconds())
	}
	return sum, nil
}
