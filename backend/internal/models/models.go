// Package models holds the domain types shared across the backend:
// the unified site/metric/alert/user shapes, and the BrandAdapter
// interface that isolates brand-specific API quirks from everything else.
package models

import (
	"context"
	"encoding/json"
	"time"
)

type Status string

const (
	StatusOnline  Status = "online"
	StatusOffline Status = "offline"
	StatusWarning Status = "warning"
	StatusError   Status = "error"

	// StatusUnknown means "we could not reach the brand's API", which is a
	// statement about our own connectivity, not about the site.
	//
	// Previously a failed fetch produced StatusOffline, so a single flaky
	// HTTP call was spelled exactly the same as a genuine outage — and the
	// alert engine fires a *critical* offline alert on that value. One
	// vendor-side hiccup could therefore page someone at 2am about a site
	// that was running fine. Nothing alerts on StatusUnknown; it is
	// deliberately excluded from the online/offline counts as well, so the
	// fleet KPIs don't silently reclassify unreachable sites as down.
	StatusUnknown Status = "unknown"

	// StatusCommissioning is a site that has been registered but has never
	// returned a successful reading. Without it, a site added at 16:00
	// immediately trips the offline rule and alerts before anyone has had
	// a chance to finish wiring it up.
	StatusCommissioning Status = "commissioning"
)

// Alertable reports whether a status represents a genuine observation of
// the site, as opposed to a gap in our own knowledge. The alert engine
// uses this as its gate: we only ever raise alerts about things we have
// actually measured.
func (s Status) Alertable() bool {
	return s != StatusUnknown && s != StatusCommissioning
}

type Brand string

const (
	BrandDeye    Brand = "deye"
	BrandIngecon Brand = "ingecon"
	BrandSosen   Brand = "sosen"
)

// SiteData is the unified reading every brand adapter normalizes its
// brand-specific API response into before it reaches storage/alerting.
//
// Every telemetry channel is a pointer, including Power and the energy
// counters. They used to be plain float64s while the rest were pointers,
// which made "the vendor did not report PV power" indistinguishable from
// "the array is producing exactly 0 W" — the same ambiguity that had
// offline Ingecon plants displaying a stale 1.6 kW beside an Offline
// badge. A nil channel means "not reported"; the UI renders an em dash and
// the alert engine skips the rule that depends on it.
type SiteData struct {
	BrandSiteID string          `json:"brand_site_id"`
	Timestamp   time.Time       `json:"timestamp"`
	Power       *float64        `json:"power_w,omitempty"`
	EnergyToday *float64        `json:"energy_today_kwh,omitempty"`
	EnergyTotal *float64        `json:"energy_total_kwh,omitempty"`
	SOC         *float64        `json:"soc,omitempty"`
	BatteryV    *float64        `json:"battery_v,omitempty"`
	BatteryI    *float64        `json:"battery_i,omitempty"`
	GridPower   *float64        `json:"grid_power_w,omitempty"`
	LoadPower   *float64        `json:"load_power_w,omitempty"`
	FaultCode   *int            `json:"fault_code,omitempty"`
	Status      Status          `json:"status"`
	Raw         json.RawMessage `json:"raw,omitempty"`
}

// F returns a pointer to v — a readability helper for adapters, which
// build SiteData literals full of optional channels.
func F(v float64) *float64 { return &v }

// PowerOr returns the reported power, or fallback when the channel is nil.
func (d SiteData) PowerOr(fallback float64) float64 {
	if d.Power == nil {
		return fallback
	}
	return *d.Power
}

// BrandAdapter is the seam every inverter brand integration implements.
// The collector, storage and alert engine only ever depend on this
// interface, never on a brand's actual API shape.
type BrandAdapter interface {
	Name() string
	FetchAll(ctx context.Context) ([]SiteData, error)
	ValidateCredentials(ctx context.Context) error
	// RateLimit reports the brand's known API limits so the collector
	// can throttle itself instead of getting the installer account banned.
	RateLimit() (requestsPerMinute int, resetWindow time.Duration)
}

type Site struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Brand              Brand     `json:"brand"`
	BrandSiteID        string    `json:"brand_site_id"`
	Location           string    `json:"location"`
	Latitude           *float64  `json:"latitude,omitempty"`
	Longitude          *float64  `json:"longitude,omitempty"`
	CapacityKW         float64   `json:"capacity_kw"`
	InstallerAccountID string    `json:"installer_account_id,omitempty"`
	IsActive           bool      `json:"is_active"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// SiteWithStatus is a Site joined with its latest known reading — the
// shape the dashboard's site grid and KPI cards actually consume.
type SiteWithStatus struct {
	Site
	Status         Status     `json:"status"`
	PowerW         *float64   `json:"power_w,omitempty"`
	EnergyTodayKWh *float64   `json:"energy_today_kwh,omitempty"`
	EnergyTotalKWh *float64   `json:"energy_total_kwh,omitempty"`
	SOC            *float64   `json:"soc,omitempty"`
	BatteryVoltage *float64   `json:"battery_voltage,omitempty"`
	BatteryCurrent *float64   `json:"battery_current,omitempty"`
	GridPowerW     *float64   `json:"grid_power_w,omitempty"`
	LoadPowerW     *float64   `json:"load_power_w,omitempty"`
	FaultCode      *int       `json:"fault_code,omitempty"`
	LastSeenAt     *time.Time `json:"last_seen_at,omitempty"`
}

type AlertType string

const (
	AlertOffline        AlertType = "offline"
	AlertProductionDrop AlertType = "production_drop"
	AlertFault          AlertType = "fault"
	AlertBatteryIssue   AlertType = "battery_issue"
)

type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityWarning  Severity = "warning"
	SeverityInfo     Severity = "info"
)

type Alert struct {
	ID             string          `json:"id"`
	SiteID         string          `json:"site_id"`
	SiteName       string          `json:"site_name,omitempty"`
	Brand          Brand           `json:"brand,omitempty"`
	Type           AlertType       `json:"type"`
	Severity       Severity        `json:"severity"`
	Message        string          `json:"message"`
	Details        json.RawMessage `json:"details,omitempty"`
	Acknowledged   bool            `json:"acknowledged"`
	AcknowledgedBy *string         `json:"acknowledged_by,omitempty"`
	AcknowledgedAt *time.Time      `json:"acknowledged_at,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	ResolvedAt     *time.Time      `json:"resolved_at,omitempty"`
}

type Role string

const (
	RoleAdmin      Role = "admin"
	RoleTechnician Role = "technician"
	RoleViewer     Role = "viewer"
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Name         string    `json:"name"`
	Role         Role      `json:"role"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
}

// FleetSummary powers the dashboard's KPI cards and power-flow visualization.
type FleetSummary struct {
	TotalSites   int     `json:"total_sites"`
	OnlineSites  int     `json:"online_sites"`
	OfflineSites int     `json:"offline_sites"`
	WarningSites int     `json:"warning_sites"`
	ErrorSites   int     `json:"error_sites"`
	TotalPowerW  float64 `json:"total_power_w"`
	TotalLoadW   float64 `json:"total_load_w"`
	TotalGridW   float64 `json:"total_grid_w"` // positive = importing, negative = exporting
	// TotalBatteryW is DERIVED, not measured: no brand in the fleet reports
	// battery current, so there is no measured battery power to sum. It is the
	// residual of the power balance, solar + grid_import - load, and is
	// therefore only meaningful across sites reporting ALL THREE terms.
	//
	// Null when no site does. It used to be a plain float summed over whatever
	// each term happened to be available for — solar across every site, load
	// across those reporting load, grid across those reporting grid — so the
	// "battery" figure was mostly just the load and grid nobody reported. On
	// the current fleet that fabricated ~25 kW of battery charging out of 12
	// sites that report no grid at all, and pointed the dashboard's battery
	// arrow the wrong way. Same null-vs-zero trap as the telemetry fields:
	// absent is not zero.
	TotalBatteryW *float64 `json:"total_battery_w"`
	// BatterySites is how many sites TotalBatteryW actually covers, so the UI
	// can say "8 of 20" rather than implying it speaks for the whole fleet.
	BatterySites   int     `json:"battery_sites"`
	AvgSOC         float64 `json:"avg_soc"`
	EnergyTodayKWh float64 `json:"energy_today_kwh"`
	ActiveAlerts   int     `json:"active_alerts"`
	DataAgeSeconds int     `json:"data_age_seconds"`
}
