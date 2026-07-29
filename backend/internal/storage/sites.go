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

// ListParams bounds a site listing.
//
// Pagination is not optional at fleet scale: the dashboard and the wall
// display both refetch this list every poll interval, and an unbounded
// query means the whole fleet crosses the wire twice per cycle per viewer.
// It was tolerable at 20 sites and would not have been at 500.
type ListParams struct {
	ActiveOnly bool
	Limit      int
	Offset     int
}

const (
	defaultListLimit = 100
	maxListLimit     = 500
)

// Normalize clamps caller-supplied paging into a sane range so a client
// can't request the entire table (or a negative offset) by accident.
func (p ListParams) Normalize() ListParams {
	if p.Limit <= 0 {
		p.Limit = defaultListLimit
	}
	if p.Limit > maxListLimit {
		p.Limit = maxListLimit
	}
	if p.Offset < 0 {
		p.Offset = 0
	}
	return p
}

// ListPage is one page of sites plus the unpaginated total, so the UI can
// render "showing 1-100 of 412" without a second round trip.
type ListPage struct {
	Sites  []models.SiteWithStatus `json:"sites"`
	Total  int                     `json:"total"`
	Limit  int                     `json:"limit"`
	Offset int                     `json:"offset"`
}

func (r *SiteRepo) List(ctx context.Context, p ListParams) (ListPage, error) {
	p = p.Normalize()

	where := ""
	if p.ActiveOnly {
		where = " WHERE s.is_active = TRUE "
	}

	var total int
	if err := r.db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM sites s`+where,
	).Scan(&total); err != nil {
		return ListPage{}, fmt.Errorf("count sites: %w", err)
	}

	query := siteWithStatusSelect + where + rankOrder + ` LIMIT $1 OFFSET $2`
	rows, err := r.db.Pool.Query(ctx, query, p.Limit, p.Offset)
	if err != nil {
		return ListPage{}, fmt.Errorf("list sites: %w", err)
	}
	defer rows.Close()

	out := make([]models.SiteWithStatus, 0, p.Limit)
	for rows.Next() {
		s, err := scanSiteWithStatus(rows)
		if err != nil {
			return ListPage{}, fmt.Errorf("scan site: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return ListPage{}, err
	}
	return ListPage{Sites: out, Total: total, Limit: p.Limit, Offset: p.Offset}, nil
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

// IDsByBrand lists the internal UUIDs of every active site for a brand.
//
// Used by the collector when a brand's FetchAll fails outright, to mark
// that brand's sites unknown rather than leaving them silently rotting
// until they all cross the offline threshold at once.
func (r *SiteRepo) IDsByBrand(ctx context.Context, brand models.Brand) ([]string, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id::text FROM sites WHERE brand = $1 AND is_active`, string(brand))
	if err != nil {
		return nil, fmt.Errorf("list site ids for brand %s: %w", brand, err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
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
	// Seed a commissioning status row alongside the site. Without it the
	// LEFT JOIN in siteWithStatusSelect coalesces a missing row to
	// 'offline', so a site created seconds ago is displayed as down — and
	// looks identical to one that genuinely stopped reporting.
	err := r.db.Pool.QueryRow(ctx, `
		WITH new_site AS (
			INSERT INTO sites (name, brand, brand_site_id, location, latitude, longitude, capacity_kw, installer_account_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''))
			RETURNING id, name, brand, brand_site_id, location, latitude, longitude, capacity_kw,
				installer_account_id, is_active, created_at, updated_at
		), seed_status AS (
			INSERT INTO site_status (site_id, status, last_seen_at)
			SELECT id, 'commissioning', NULL FROM new_site
			ON CONFLICT (site_id) DO NOTHING
		)
		SELECT id::text, name, brand, brand_site_id, location, latitude, longitude, capacity_kw,
			COALESCE(installer_account_id, ''), is_active, created_at, updated_at
		FROM new_site
	`, in.Name, string(in.Brand), in.BrandSiteID, in.Location, in.Latitude, in.Longitude, in.CapacityKW, in.InstallerAccountID,
	).Scan(&s.ID, &s.Name, &s.Brand, &s.BrandSiteID, &s.Location, &s.Latitude, &s.Longitude,
		&s.CapacityKW, &s.InstallerAccountID, &s.IsActive, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create site: %w", err)
	}
	return &s, nil
}

type UpdateSiteInput struct {
	Name       *string
	Location   *string
	Latitude   *float64
	Longitude  *float64
	CapacityKW *float64
	IsActive   *bool
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

// UpsertDiscovered registers or refreshes a site auto-discovered via a
// brand's SiteDescriber.
//
// Field ownership is the whole design here. This used to be
// ON CONFLICT DO NOTHING, which meant vendor metadata was frozen at
// first sight: rename a plant in DeyeCloud and this platform displayed the
// old name forever, with no way to fix it short of an admin retyping it.
// But a blanket upsert is worse — it would stomp the capacity an admin had
// to type in by hand precisely because the vendor doesn't expose one
// (every Ingecon plant), overwriting it with 0 on the very next cycle.
//
// So the columns are split by who is authoritative for them:
//
//   - name, location: the vendor owns these. Always refreshed, but only
//     from a non-empty value, so a sparse describer can't blank them.
//   - capacity_kw: the vendor owns it only when it actually reports one.
//     COALESCE(NULLIF(excluded, 0), existing) keeps an admin's hand-entered
//     figure when the API has nothing to say.
//   - is_active, latitude/longitude, installer_account_id: operator-owned.
//     Never touched here — deactivating a site must not be undone by the
//     next poll.
func (r *SiteRepo) UpsertDiscovered(ctx context.Context, brand models.Brand, d adapters.SiteDescriptor) error {
	_, err := r.db.Pool.Exec(ctx, `
		WITH upserted AS (
		INSERT INTO sites (name, brand, brand_site_id, location, capacity_kw)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (brand, brand_site_id) DO UPDATE SET
			name         = COALESCE(NULLIF(EXCLUDED.name, ''), sites.name),
			location     = COALESCE(NULLIF(EXCLUDED.location, ''), sites.location),
			capacity_kw  = COALESCE(NULLIF(EXCLUDED.capacity_kw, 0), sites.capacity_kw),
			updated_at   = NOW()
		WHERE sites.name        IS DISTINCT FROM COALESCE(NULLIF(EXCLUDED.name, ''), sites.name)
		   OR sites.location    IS DISTINCT FROM COALESCE(NULLIF(EXCLUDED.location, ''), sites.location)
		   OR sites.capacity_kw IS DISTINCT FROM COALESCE(NULLIF(EXCLUDED.capacity_kw, 0), sites.capacity_kw)
		RETURNING id
		)
		INSERT INTO site_status (site_id, status, last_seen_at)
		SELECT id, 'commissioning', NULL FROM upserted
		ON CONFLICT (site_id) DO NOTHING
	`, d.Name, string(brand), d.BrandSiteID, d.Location, d.CapacityKW)
	if err != nil {
		return fmt.Errorf("upsert discovered site: %w", err)
	}
	return nil
}

// upsertStatusSQL writes the latest-known-reading row the dashboard reads
// on every poll. Shared with ReadingStore, which runs it inside the same
// transaction as the matching site_metrics insert.
const upsertStatusSQL = `
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
`

func (r *SiteRepo) FleetSummary(ctx context.Context) (models.FleetSummary, error) {
	var sum models.FleetSummary
	var latestSeen *time.Time
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
			-- MAX, not MIN: DataAgeSeconds answers "is the collection
			-- pipeline still running?", so it tracks the most recent
			-- successful read across the fleet. MIN would pin it to the
			-- single stalest site, and since an offline site's last_seen_at
			-- never advances, the value could only ever grow — reporting a
			-- dead pipeline forever while 49 of 50 sites poll normally.
			-- Per-site staleness is already surfaced elsewhere: each site
			-- card shows its own "last seen", and the alert engine raises an
			-- offline alert per site.
			MAX(st.last_seen_at) FILTER (WHERE s.is_active)
		FROM sites s
		LEFT JOIN site_status st ON st.site_id = s.id
	`).Scan(
		&sum.TotalSites, &sum.OnlineSites, &sum.OfflineSites, &sum.WarningSites, &sum.ErrorSites,
		&sum.TotalPowerW, &sum.TotalLoadW, &sum.TotalGridW, &sum.AvgSOC, &sum.EnergyTodayKWh,
		&latestSeen,
	)
	if err != nil {
		return sum, fmt.Errorf("fleet summary: %w", err)
	}
	// Power balance: generation + grid import = load + battery charging
	// (grid negative = exporting, battery negative = discharging), so
	// battery = power + grid - load.
	sum.TotalBatteryW = sum.TotalPowerW + sum.TotalGridW - sum.TotalLoadW
	if latestSeen != nil {
		sum.DataAgeSeconds = int(time.Since(*latestSeen).Seconds())
	}
	return sum, nil
}
