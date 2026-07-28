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
)

type Brand string

const (
	BrandDeye    Brand = "deye"
	BrandIngecon Brand = "ingecon"
	BrandSosen   Brand = "sosen"
)

// SiteData is the unified reading every brand adapter normalizes its
// brand-specific API response into before it reaches storage/alerting.
type SiteData struct {
	BrandSiteID string          `json:"brand_site_id"`
	Timestamp   time.Time       `json:"timestamp"`
	Power       float64         `json:"power_w"`
	EnergyToday float64         `json:"energy_today_kwh"`
	EnergyTotal float64         `json:"energy_total_kwh"`
	SOC         *float64        `json:"soc,omitempty"`
	BatteryV    *float64        `json:"battery_v,omitempty"`
	BatteryI    *float64        `json:"battery_i,omitempty"`
	GridPower   *float64        `json:"grid_power_w,omitempty"`
	LoadPower   *float64        `json:"load_power_w,omitempty"`
	FaultCode   *int            `json:"fault_code,omitempty"`
	Status      Status          `json:"status"`
	Raw         json.RawMessage `json:"raw,omitempty"`
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
	TotalSites     int     `json:"total_sites"`
	OnlineSites    int     `json:"online_sites"`
	OfflineSites   int     `json:"offline_sites"`
	WarningSites   int     `json:"warning_sites"`
	ErrorSites     int     `json:"error_sites"`
	TotalPowerW    float64 `json:"total_power_w"`
	TotalLoadW     float64 `json:"total_load_w"`
	TotalGridW     float64 `json:"total_grid_w"` // positive = importing, negative = exporting
	TotalBatteryW  float64 `json:"total_battery_w"`
	AvgSOC         float64 `json:"avg_soc"`
	EnergyTodayKWh float64 `json:"energy_today_kwh"`
	ActiveAlerts   int     `json:"active_alerts"`
	DataAgeSeconds int     `json:"data_age_seconds"`
}
