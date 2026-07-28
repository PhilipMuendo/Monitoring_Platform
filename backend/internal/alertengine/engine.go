// Package alertengine implements the brief's state-based alert rules:
// every check requires multiple consecutive bad readings (or an explicit
// duration threshold) before firing, specifically to avoid false alarms
// from a single transient blip. Each rule has its own cooldown so a
// persistently flaky site doesn't spam a new alert every 5-minute cycle.
package alertengine

import (
	"context"
	"fmt"
	"time"

	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

type Config struct {
	ProductionDropWindow     int           // consecutive low readings required
	ProductionDropThresholdW float64       // "low" = below this many watts
	ProductionDropCooldown   time.Duration

	OfflineThreshold time.Duration // no data for this long = offline
	OfflineCooldown  time.Duration

	FaultCooldown time.Duration

	BatteryWindow          int
	BatterySOCThresholdPct float64
	BatteryCooldown        time.Duration

	// Daytime window (Africa/Nairobi, EAT = UTC+3), hardcoded per the
	// brief's single-country-deployment decision — production-drop
	// alerts only make sense while the sun is actually up.
	DaytimeStartHour   int
	DaytimeEndMinutes  int // end hour expressed in minutes-past-midnight, e.g. 18:30 = 1110
}

func DefaultConfig() Config {
	return Config{
		ProductionDropWindow:     2,
		ProductionDropThresholdW: 50,
		ProductionDropCooldown:   30 * time.Minute,

		OfflineThreshold: 10 * time.Minute,
		OfflineCooldown:  60 * time.Minute,

		FaultCooldown: 60 * time.Minute,

		BatteryWindow:          3,
		BatterySOCThresholdPct: 20,
		BatteryCooldown:        120 * time.Minute,

		DaytimeStartHour:  6,
		DaytimeEndMinutes: 18*60 + 30,
	}
}

// Notifier lets the alert engine push live updates (e.g. over SSE)
// without depending on the api package — implemented there and injected
// here, keeping the dependency direction api -> alertengine, not the
// reverse.
type Notifier interface {
	Publish(eventType string, data any)
}

type noopNotifier struct{}

func (noopNotifier) Publish(string, any) {}

type Engine struct {
	alerts   *storage.AlertRepo
	metrics  *storage.MetricsRepo
	cfg      Config
	notifier Notifier
}

func New(alerts *storage.AlertRepo, metrics *storage.MetricsRepo, cfg Config) *Engine {
	return &Engine{alerts: alerts, metrics: metrics, cfg: cfg, notifier: noopNotifier{}}
}

// WithNotifier attaches a live-push notifier (e.g. the API's SSE hub).
func (e *Engine) WithNotifier(n Notifier) *Engine {
	e.notifier = n
	return e
}

// isDaytime hardcodes Africa/Nairobi (EAT, UTC+3) per the brief — a
// single-country deployment doesn't need real timezone-DB handling.
func isDaytime(t time.Time, cfg Config) bool {
	eat := t.UTC().Add(3 * time.Hour)
	minutesPastMidnight := eat.Hour()*60 + eat.Minute()
	return minutesPastMidnight >= cfg.DaytimeStartHour*60 && minutesPastMidnight <= cfg.DaytimeEndMinutes
}

// Evaluate runs every rule for one site's just-recorded reading. Called
// once per site per collection cycle, immediately after the reading has
// been written to site_metrics (so RecentReadings sees it).
func (e *Engine) Evaluate(ctx context.Context, siteID, siteName string, reading models.SiteData) error {
	recent, err := e.metrics.RecentReadings(ctx, siteID, e.cfg.BatteryWindow+1)
	if err != nil {
		return fmt.Errorf("alertengine: fetch recent readings: %w", err)
	}

	if err := e.checkOffline(ctx, siteID, siteName, reading); err != nil {
		return err
	}
	if err := e.checkFault(ctx, siteID, siteName, reading); err != nil {
		return err
	}
	if err := e.checkProductionDrop(ctx, siteID, siteName, reading, recent); err != nil {
		return err
	}
	if err := e.checkBattery(ctx, siteID, siteName, recent); err != nil {
		return err
	}
	return nil
}

func (e *Engine) checkOffline(ctx context.Context, siteID, siteName string, reading models.SiteData) error {
	stale := time.Since(reading.Timestamp) >= e.cfg.OfflineThreshold
	condition := reading.Status == models.StatusOffline || stale

	message := fmt.Sprintf("%s has not reported data in over %d minutes", siteName, int(e.cfg.OfflineThreshold.Minutes()))
	return e.evaluateRule(ctx, siteID, models.AlertOffline, models.SeverityCritical,
		condition, e.cfg.OfflineCooldown, message,
		map[string]any{"last_seen": reading.Timestamp}, false)
}

func (e *Engine) checkFault(ctx context.Context, siteID, siteName string, reading models.SiteData) error {
	condition := reading.FaultCode != nil && *reading.FaultCode != 0
	code := 0
	if reading.FaultCode != nil {
		code = *reading.FaultCode
	}
	message := fmt.Sprintf("%s reported inverter fault code %d", siteName, code)
	return e.evaluateRule(ctx, siteID, models.AlertFault, models.SeverityCritical,
		condition, e.cfg.FaultCooldown, message,
		map[string]any{"fault_code": code}, false)
}

func (e *Engine) checkProductionDrop(ctx context.Context, siteID, siteName string, reading models.SiteData, recent []models.SiteData) error {
	if !isDaytime(reading.Timestamp, e.cfg) {
		return e.evaluateRule(ctx, siteID, models.AlertProductionDrop, models.SeverityWarning, false, e.cfg.ProductionDropCooldown, "", nil, true)
	}
	if len(recent) < e.cfg.ProductionDropWindow {
		return nil
	}

	lowCount := 0
	for _, r := range recent[:e.cfg.ProductionDropWindow] {
		if r.Power < e.cfg.ProductionDropThresholdW {
			lowCount++
		}
	}
	condition := lowCount >= e.cfg.ProductionDropWindow

	message := fmt.Sprintf("%s production below %.0fW for %d consecutive readings during daylight",
		siteName, e.cfg.ProductionDropThresholdW, e.cfg.ProductionDropWindow)
	return e.evaluateRule(ctx, siteID, models.AlertProductionDrop, models.SeverityWarning,
		condition, e.cfg.ProductionDropCooldown, message,
		map[string]any{"power_w": reading.Power, "window": e.cfg.ProductionDropWindow}, true)
}

func (e *Engine) checkBattery(ctx context.Context, siteID, siteName string, recent []models.SiteData) error {
	if len(recent) < e.cfg.BatteryWindow {
		return nil
	}

	lowCount := 0
	var lastSOC float64
	for i, r := range recent[:e.cfg.BatteryWindow] {
		if r.SOC != nil {
			if i == 0 {
				lastSOC = *r.SOC
			}
			if *r.SOC < e.cfg.BatterySOCThresholdPct {
				lowCount++
			}
		}
	}
	condition := lowCount >= e.cfg.BatteryWindow

	message := fmt.Sprintf("%s battery SOC below %.0f%% for %d consecutive readings",
		siteName, e.cfg.BatterySOCThresholdPct, e.cfg.BatteryWindow)
	return e.evaluateRule(ctx, siteID, models.AlertBatteryIssue, models.SeverityWarning,
		condition, e.cfg.BatteryCooldown, message,
		map[string]any{"soc": lastSOC, "window": e.cfg.BatteryWindow}, true)
}

// evaluateRule is the shared state machine every rule above drives:
//   - condition true, no active alert, past cooldown  -> create alert
//   - condition true, already active                  -> no-op (still ongoing)
//   - condition true, resolved but within cooldown     -> no-op (avoid spam)
//   - condition false, autoResolve, still active       -> resolve
//   - condition false, otherwise                       -> no-op
//
// Critical alerts (offline/fault) pass autoResolve=false: per the brief
// they stay active until a human acknowledges them, even if the
// underlying condition clears on its own.
func (e *Engine) evaluateRule(ctx context.Context, siteID string, alertType models.AlertType, severity models.Severity,
	conditionMet bool, cooldown time.Duration, message string, details any, autoResolve bool) error {

	latest, err := e.alerts.LatestByTypeForSite(ctx, siteID, alertType)
	if err != nil {
		return fmt.Errorf("alertengine: latest alert lookup: %w", err)
	}

	if conditionMet {
		if latest != nil && latest.ResolvedAt == nil {
			return nil
		}
		if latest != nil && latest.ResolvedAt != nil && time.Since(*latest.ResolvedAt) < cooldown {
			return nil
		}
		created, err := e.alerts.Create(ctx, siteID, alertType, severity, message, details)
		if err != nil {
			return fmt.Errorf("alertengine: create alert: %w", err)
		}
		e.notifier.Publish("alert.created", created)
		return nil
	}

	if autoResolve && latest != nil && latest.ResolvedAt == nil {
		if err := e.alerts.Resolve(ctx, latest.ID); err != nil {
			return fmt.Errorf("alertengine: resolve alert: %w", err)
		}
		e.notifier.Publish("alert.resolved", latest)
	}
	return nil
}
