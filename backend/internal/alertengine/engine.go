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
	ProductionDropWindow     int     // consecutive low readings required
	ProductionDropThresholdW float64 // "low" = below this many watts
	// ProductionRecoverThresholdW is the HYSTERESIS band's upper edge: an
	// open production alert clears only once output is sustained above this,
	// not merely back over the firing threshold.
	//
	// Without a gap between the two, a site sitting near the threshold
	// oscillates across it and the rule reports weather as incidents. Live
	// data before this existed: one site produced five separate "incidents"
	// in a single morning, each ~20 minutes long, as output ramped through
	// 50W at dawn and again through broken cloud.
	ProductionRecoverThresholdW float64
	ProductionDropCooldown      time.Duration
	// ProductionEdgeMargin excludes the first and last stretch of daylight
	// from judgement. Output legitimately crosses any low threshold at dawn
	// and dusk, and alerting on sunrise is alerting on the solar system
	// working correctly.
	ProductionEdgeMargin time.Duration

	OfflineThreshold time.Duration // no data for this long = offline
	OfflineCooldown  time.Duration

	FaultCooldown time.Duration

	BatteryWindow          int
	BatterySOCThresholdPct float64
	// BatterySOCRecoverPct is the same hysteresis idea for SOC: a battery
	// hovering at the threshold would otherwise flap as it trickle-charges.
	BatterySOCRecoverPct float64
	BatteryCooldown      time.Duration

	// Daytime window (Africa/Nairobi, EAT = UTC+3), hardcoded per the
	// brief's single-country-deployment decision — production-drop
	// alerts only make sense while the sun is actually up.
	DaytimeStartHour  int
	DaytimeEndMinutes int // end hour expressed in minutes-past-midnight, e.g. 18:30 = 1110
}

func DefaultConfig() Config {
	return Config{
		// 6 readings at the default 5-minute poll is ~30 minutes of sustained
		// low output before anyone is told. Was 2 (10 minutes), which is
		// shorter than a passing cloud.
		ProductionDropWindow:     6,
		ProductionDropThresholdW: 50,
		// 3x the firing threshold. Wide on purpose: the gap has to be bigger
		// than the noise, and irradiance noise on a partly cloudy day is
		// large.
		ProductionRecoverThresholdW: 150,
		// Longer than the old 30 minutes, which was shorter than the
		// oscillation it was supposed to damp and so damped nothing.
		ProductionDropCooldown: 2 * time.Hour,
		ProductionEdgeMargin:   60 * time.Minute,

		OfflineThreshold: 10 * time.Minute,
		OfflineCooldown:  60 * time.Minute,

		FaultCooldown: 60 * time.Minute,

		BatteryWindow:          3,
		BatterySOCThresholdPct: 20,
		BatterySOCRecoverPct:   30,
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

// AlertRecorder observes alerts as they fire. Kept as a narrow interface
// so alertengine does not depend on the metrics package.
type AlertRecorder interface {
	ObserveAlert(alertType, severity string)
}

type noopRecorder struct{}

func (noopRecorder) ObserveAlert(string, string) {}

type Engine struct {
	alerts   *storage.AlertRepo
	metrics  *storage.MetricsRepo
	cfg      Config
	notifier Notifier
	recorder AlertRecorder
}

func New(alerts *storage.AlertRepo, metrics *storage.MetricsRepo, cfg Config) *Engine {
	return &Engine{
		alerts:   alerts,
		metrics:  metrics,
		cfg:      cfg,
		notifier: noopNotifier{},
		recorder: noopRecorder{},
	}
}

// WithMetrics attaches an alert counter. Alert rate over time is the
// signal that tells you a rule is too sensitive long before anyone files
// a complaint about noise.
func (e *Engine) WithMetrics(r AlertRecorder) *Engine {
	e.recorder = r
	return e
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

// isProductionJudgeable reports whether output at this instant says anything
// about the site's health.
//
// Narrower than isDaytime by ProductionEdgeMargin at each end. A working array
// crosses any low-output threshold twice a day on its way up and down, and the
// old rule alerted on exactly that: the earliest flapping alerts in the live
// data fired at 05:36 and 06:29, which is sunrise, not a fault.
func isProductionJudgeable(t time.Time, cfg Config) bool {
	eat := t.UTC().Add(3 * time.Hour)
	minutesPastMidnight := eat.Hour()*60 + eat.Minute()
	margin := int(cfg.ProductionEdgeMargin.Minutes())
	return minutesPastMidnight >= cfg.DaytimeStartHour*60+margin &&
		minutesPastMidnight <= cfg.DaytimeEndMinutes-margin
}

// ruleState is what a rule concluded from this cycle's readings.
//
// Three states, not a bool, because "the condition is not currently true" and
// "the condition is definitively over" are different claims — and collapsing
// them is what made the production rule flap. Between the firing and recovery
// thresholds, and outside judgeable daylight, a rule holds: it neither raises
// nor resolves, and an open alert simply stays open.
type ruleState int

const (
	ruleHolding ruleState = iota
	ruleFiring
	ruleClear
)

// windowState decides a rule's state from one window of readings against a
// hysteresis band: fire only if EVERY reading is below fireBelow, clear only
// if every reading is above clearAbove, hold otherwise.
//
// Requiring the whole window at BOTH edges is what creates the band. No single
// reading can move the state in either direction, which is precisely what
// stops a site drifting around the threshold from raising and clearing over
// and over — the failure that produced five "incidents" in one morning.
//
// Shared by production and battery because the shape of the decision is
// identical; only the units differ.
func windowState(values []float64, fireBelow, clearAbove float64) ruleState {
	if len(values) == 0 {
		return ruleHolding
	}
	low, recovered := 0, 0
	for _, v := range values {
		if v < fireBelow {
			low++
		}
		if v > clearAbove {
			recovered++
		}
	}
	switch {
	case low == len(values):
		return ruleFiring
	case recovered == len(values):
		return ruleClear
	default:
		return ruleHolding
	}
}

// Evaluate runs every rule for one site's just-recorded reading. Called
// once per site per collection cycle, immediately after the reading has
// been written to site_metrics (so RecentReadings sees it).
func (e *Engine) Evaluate(ctx context.Context, siteID, siteName string, reading models.SiteData) error {
	// We only ever raise alerts about things we have actually measured.
	//
	// StatusUnknown means the vendor API was unreachable this cycle, and
	// StatusCommissioning means the site has never reported at all. Neither
	// is evidence about the site. Before this gate existed a single flaky
	// HTTP call produced StatusOffline, which checkOffline escalated to a
	// *critical* alert — the fastest route to an on-call rota that has
	// learned to ignore this system.
	//
	// Note we return before touching any rule, including auto-resolve: an
	// unreachable cycle must not resolve a genuine alert either. The alert
	// stays open until we can see the site again.
	if !reading.Status.Alertable() {
		return nil
	}

	// Fetch enough for the LONGEST window any rule needs, not just the
	// battery one. Production drop now needs 6 readings against battery's 3;
	// fetching battery+1 would have left checkProductionDrop permanently
	// short of data and silently disabled it.
	need := max(e.cfg.BatteryWindow, e.cfg.ProductionDropWindow)
	recent, err := e.metrics.RecentReadings(ctx, siteID, need+1)
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
	// Clears as soon as the site reports again. No hysteresis band: "we
	// received a reading" is unambiguous in a way that "output is low" is not.
	return e.evaluateRule(ctx, siteID, models.AlertOffline, models.SeverityCritical,
		firingWhen(condition), e.cfg.OfflineCooldown, message,
		map[string]any{"last_seen": reading.Timestamp})
}

// firingWhen maps a plain condition onto the tri-state for rules whose
// condition is unambiguous — no hysteresis band, so "not firing" really does
// mean "over".
func firingWhen(condition bool) ruleState {
	if condition {
		return ruleFiring
	}
	return ruleClear
}

func (e *Engine) checkFault(ctx context.Context, siteID, siteName string, reading models.SiteData) error {
	condition := reading.FaultCode != nil && *reading.FaultCode != 0
	code := 0
	if reading.FaultCode != nil {
		code = *reading.FaultCode
	}
	message := fmt.Sprintf("%s reported inverter fault code %d", siteName, code)
	// Clears when the inverter stops reporting the fault, which is the
	// inverter's own statement that the fault is gone.
	return e.evaluateRule(ctx, siteID, models.AlertFault, models.SeverityCritical,
		firingWhen(condition), e.cfg.FaultCooldown, message,
		map[string]any{"fault_code": code})
}

func (e *Engine) checkProductionDrop(ctx context.Context, siteID, siteName string, reading models.SiteData, recent []models.SiteData) error {
	// HOLD outside judgeable daylight — do not clear.
	//
	// This used to resolve the alert every evening, which is the whole
	// mechanism behind the flapping: an alert raised at midday was resolved
	// by nightfall and re-raised at dawn, so one chronically underperforming
	// site produced a fresh "incident" every morning. Holding means a site
	// that is genuinely underproducing keeps ONE open alert across nights
	// until it actually recovers.
	if !isProductionJudgeable(reading.Timestamp, e.cfg) {
		return nil
	}
	if len(recent) < e.cfg.ProductionDropWindow {
		return nil
	}

	// A window is only judged when every reading in it actually carries a
	// power figure. A nil Power means the vendor didn't report the channel;
	// counting that as "below threshold" would manufacture a production-drop
	// alert out of missing data.
	powers := make([]float64, 0, e.cfg.ProductionDropWindow)
	for _, r := range recent[:e.cfg.ProductionDropWindow] {
		if r.Power == nil {
			return nil
		}
		powers = append(powers, *r.Power)
	}
	state := windowState(powers, e.cfg.ProductionDropThresholdW, e.cfg.ProductionRecoverThresholdW)

	message := fmt.Sprintf("%s production below %.0fW for %d consecutive readings during daylight",
		siteName, e.cfg.ProductionDropThresholdW, e.cfg.ProductionDropWindow)
	return e.evaluateRule(ctx, siteID, models.AlertProductionDrop, models.SeverityWarning,
		state, e.cfg.ProductionDropCooldown, message,
		map[string]any{"power_w": reading.Power, "window": e.cfg.ProductionDropWindow})
}

func (e *Engine) checkBattery(ctx context.Context, siteID, siteName string, recent []models.SiteData) error {
	if len(recent) < e.cfg.BatteryWindow {
		return nil
	}

	// As with production drop: judge the window only if every reading in it
	// reports SOC. A site with no battery reports nil forever, and counting
	// those as "not low" was harmless, but a partially-reported window
	// could never reach the threshold and silently disabled the rule.
	// Same hysteresis band as production: a battery trickle-charging across
	// 20% would otherwise raise and clear repeatedly on its way up.
	socs := make([]float64, 0, e.cfg.BatteryWindow)
	var lastSOC float64
	for i, r := range recent[:e.cfg.BatteryWindow] {
		if r.SOC == nil {
			return nil
		}
		if i == 0 {
			lastSOC = *r.SOC
		}
		socs = append(socs, *r.SOC)
	}
	state := windowState(socs, e.cfg.BatterySOCThresholdPct, e.cfg.BatterySOCRecoverPct)

	message := fmt.Sprintf("%s battery SOC below %.0f%% for %d consecutive readings",
		siteName, e.cfg.BatterySOCThresholdPct, e.cfg.BatteryWindow)
	return e.evaluateRule(ctx, siteID, models.AlertBatteryIssue, models.SeverityWarning,
		state, e.cfg.BatteryCooldown, message,
		map[string]any{"soc": lastSOC, "window": e.cfg.BatteryWindow})
}

// evaluateRule is the shared state machine every rule above drives:
//   - condition true, no active alert, past cooldown  -> create alert
//   - ruleFiring, no active alert, past cooldown  -> create alert
//   - ruleFiring, already active                  -> no-op (still ongoing)
//   - ruleFiring, resolved but within cooldown    -> no-op (avoid spam)
//   - ruleClear, still active                     -> resolve
//   - ruleHolding                                 -> no-op, whatever the state
//
// EVERY rule now auto-resolves, including the critical ones. They used to
// pass autoResolve=false so that a critical stayed active until a human
// acknowledged it — but resolved_at and acknowledged are independent
// columns, so keeping an alert "active" was never what preserved the audit
// trail; acknowledgement already did that. What it actually produced was a
// write-only channel: measured on live data, 13 offline alerts were active
// while only ONE of their sites was actually offline. Four were for sites
// that had recovered and were online at that moment. An alert list that is
// 92% false is one people stop reading.
//
// Resolving means "this condition is no longer true", not "someone dealt
// with it". Acknowledgement still means the latter, and is untouched.
func (e *Engine) evaluateRule(ctx context.Context, siteID string, alertType models.AlertType, severity models.Severity,
	state ruleState, cooldown time.Duration, message string, details any) error {

	if state == ruleHolding {
		return nil
	}

	latest, err := e.alerts.LatestByTypeForSite(ctx, siteID, alertType)
	if err != nil {
		return fmt.Errorf("alertengine: latest alert lookup: %w", err)
	}

	if state == ruleFiring {
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
		e.recorder.ObserveAlert(string(alertType), string(severity))
		return nil
	}

	if latest != nil && latest.ResolvedAt == nil {
		if err := e.alerts.Resolve(ctx, latest.ID); err != nil {
			return fmt.Errorf("alertengine: resolve alert: %w", err)
		}
		e.notifier.Publish("alert.resolved", latest)
	}
	return nil
}
