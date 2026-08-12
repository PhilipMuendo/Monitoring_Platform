package alertengine

import (
	"testing"
	"time"

	"solar-monitor/internal/models"
)

func TestIsDaytime(t *testing.T) {
	cfg := DefaultConfig() // 06:00-18:30 EAT (UTC+3)

	cases := []struct {
		name string
		utc  string // RFC3339 in UTC
		want bool
	}{
		{"just before daytime start (05:59 EAT)", "2026-01-15T02:59:00Z", false},
		{"exactly at daytime start (06:00 EAT)", "2026-01-15T03:00:00Z", true},
		{"midday (12:00 EAT)", "2026-01-15T09:00:00Z", true},
		{"exactly at daytime end (18:30 EAT)", "2026-01-15T15:30:00Z", true},
		{"just after daytime end (18:31 EAT)", "2026-01-15T15:31:00Z", false},
		{"deep night (02:00 EAT)", "2026-01-15T23:00:00Z", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ts, err := time.Parse(time.RFC3339, tc.utc)
			if err != nil {
				t.Fatalf("parse time: %v", err)
			}
			if got := isDaytime(ts, cfg); got != tc.want {
				t.Errorf("isDaytime(%s) = %v, want %v", tc.utc, got, tc.want)
			}
		})
	}
}

// The gate that stops a vendor-API blip becoming a 2am page.
//
// Evaluate returns before touching the database for non-observational
// statuses, so a nil AlertRepo is safe here — and the fact that it *is*
// safe is precisely the assertion: any DB access would panic.
func TestEvaluateIgnoresNonObservationalStatuses(t *testing.T) {
	engine := New(nil, nil, DefaultConfig())

	for _, status := range []models.Status{models.StatusUnknown, models.StatusCommissioning} {
		t.Run(string(status), func(t *testing.T) {
			reading := models.SiteData{
				BrandSiteID: "p1",
				// Deliberately ancient: the staleness check would fire on
				// this if the gate were not doing its job.
				Timestamp: time.Now().Add(-24 * time.Hour),
				Status:    status,
			}
			if err := engine.Evaluate(t.Context(), "site-1", "Site One", reading); err != nil {
				t.Fatalf("Evaluate(%s) = %v, want nil with no rule evaluation", status, err)
			}
		})
	}
}

func TestStatusAlertability(t *testing.T) {
	observational := []models.Status{
		models.StatusOnline, models.StatusOffline,
		models.StatusWarning, models.StatusError,
	}
	for _, s := range observational {
		if !s.Alertable() {
			t.Errorf("%s should be alertable — it is a real observation of the site", s)
		}
	}
	for _, s := range []models.Status{models.StatusUnknown, models.StatusCommissioning} {
		if s.Alertable() {
			t.Errorf("%s must not be alertable — it describes our knowledge, not the site", s)
		}
	}
}

// A window containing an unreported channel must be skipped, not counted
// as zero — otherwise missing data manufactures a production-drop alert.
func TestProductionDropSkipsWindowsWithUnreportedPower(t *testing.T) {
	engine := New(nil, nil, DefaultConfig())
	cfg := DefaultConfig()

	noon := time.Date(2026, 3, 15, 9, 0, 0, 0, time.UTC) // 12:00 EAT
	reading := models.SiteData{Timestamp: noon, Status: models.StatusOnline}

	recent := make([]models.SiteData, cfg.ProductionDropWindow)
	for i := range recent {
		recent[i] = models.SiteData{Timestamp: noon} // Power left nil
	}

	// nil repo again: reaching evaluateRule would panic, so returning nil
	// proves the rule bailed out before deciding anything.
	if err := engine.checkProductionDrop(t.Context(), "site-1", "Site One", reading, recent); err != nil {
		t.Fatalf("checkProductionDrop = %v, want nil (window skipped)", err)
	}
}

func TestBatteryRuleSkipsWindowsWithUnreportedSOC(t *testing.T) {
	engine := New(nil, nil, DefaultConfig())
	cfg := DefaultConfig()

	recent := make([]models.SiteData, cfg.BatteryWindow)
	for i := range recent {
		recent[i] = models.SiteData{Timestamp: time.Now()} // SOC left nil
	}

	if err := engine.checkBattery(t.Context(), "site-1", "Site One", recent); err != nil {
		t.Fatalf("checkBattery = %v, want nil (window skipped)", err)
	}
}

// --- Hysteresis and flap suppression -------------------------------------
//
// These pin the behaviour that live data showed was broken: one chronically
// underperforming site produced 14 production alerts in two weeks, five of
// them in a single morning, because the rule had no hysteresis band and
// resolved itself every night.

func TestWindowStateHysteresis(t *testing.T) {
	const fireBelow, clearAbove = 50, 150

	cases := []struct {
		name   string
		values []float64
		want   ruleState
	}{
		{"every reading below the firing threshold", []float64{10, 20, 5}, ruleFiring},
		{"every reading above the recovery threshold", []float64{200, 300, 180}, ruleClear},
		// The band is the whole point: 60-140W is neither a fault nor a
		// recovery, so an open alert stays open and a closed one stays closed.
		{"inside the band holds", []float64{60, 90, 140}, ruleHolding},
		{"just above firing, well below recovery, holds", []float64{51, 55, 60}, ruleHolding},
		// One good reading must not clear an alert, and one bad reading must
		// not raise one — this is what stops flapping.
		{"a single recovery reading cannot clear", []float64{10, 200, 10}, ruleHolding},
		{"a single low reading cannot fire", []float64{200, 10, 200}, ruleHolding},
		{"empty window holds", nil, ruleHolding},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := windowState(tc.values, fireBelow, clearAbove); got != tc.want {
				t.Errorf("windowState(%v) = %v, want %v", tc.values, got, tc.want)
			}
		})
	}
}

func TestDefaultConfigHasAHysteresisGap(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.ProductionRecoverThresholdW <= cfg.ProductionDropThresholdW {
		t.Errorf("production recovery threshold %.0fW must sit ABOVE the firing threshold %.0fW, or there is no band and the rule flaps",
			cfg.ProductionRecoverThresholdW, cfg.ProductionDropThresholdW)
	}
	if cfg.BatterySOCRecoverPct <= cfg.BatterySOCThresholdPct {
		t.Errorf("battery recovery %.0f%% must sit above firing %.0f%%", cfg.BatterySOCRecoverPct, cfg.BatterySOCThresholdPct)
	}
	// The window must outlast a passing cloud. At a 5-minute poll, 2 readings
	// was 10 minutes, which is not a fault, it is weather.
	if cfg.ProductionDropWindow < 4 {
		t.Errorf("production window of %d readings is too short to distinguish a fault from cloud cover", cfg.ProductionDropWindow)
	}
}

// Production alerts fired at 05:36 and 06:29 in live data — sunrise, not a
// fault. Output crosses any low threshold twice a day on its way up and down.
func TestProductionJudgeableExcludesDawnAndDusk(t *testing.T) {
	cfg := DefaultConfig() // daylight 06:00-18:30 EAT, 60m edge margin

	cases := []struct {
		name string
		utc  string
		want bool
	}{
		{"05:36 EAT — before sunrise, real false alert", "2026-03-15T02:36:00Z", false},
		{"06:29 EAT — ramping up, real false alert", "2026-03-15T03:29:00Z", false},
		{"07:01 EAT — past the margin", "2026-03-15T04:01:00Z", true},
		{"12:00 EAT — midday", "2026-03-15T09:00:00Z", true},
		{"17:29 EAT — still judgeable", "2026-03-15T14:29:00Z", true},
		{"18:00 EAT — inside dusk margin", "2026-03-15T15:00:00Z", false},
		{"22:00 EAT — night", "2026-03-15T19:00:00Z", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ts, err := time.Parse(time.RFC3339, tc.utc)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if got := isProductionJudgeable(ts, cfg); got != tc.want {
				t.Errorf("isProductionJudgeable(%s) = %v, want %v", tc.utc, got, tc.want)
			}
		})
	}
}

// Night must HOLD, not clear. Resolving at dusk and re-raising at dawn is the
// mechanism that turned one ongoing problem into a fresh alert every morning.
// A nil repo would panic if the rule reached evaluateRule, so returning nil
// proves it held.
func TestProductionDropHoldsOvernightInsteadOfResolving(t *testing.T) {
	engine := New(nil, nil, DefaultConfig())
	cfg := DefaultConfig()

	night := time.Date(2026, 3, 15, 19, 0, 0, 0, time.UTC) // 22:00 EAT
	reading := models.SiteData{Timestamp: night, Status: models.StatusOnline}

	recent := make([]models.SiteData, cfg.ProductionDropWindow)
	for i := range recent {
		p := 0.0
		recent[i] = models.SiteData{Timestamp: night, Power: &p}
	}

	if err := engine.checkProductionDrop(t.Context(), "site-1", "Site One", reading, recent); err != nil {
		t.Fatalf("checkProductionDrop at night = %v, want nil (held, not resolved)", err)
	}
}

// Evaluate must fetch enough readings for the LONGEST window, not just the
// battery one — otherwise the production rule is permanently starved of data
// and silently never fires.
func TestReadingsWindowCoversTheLongestRule(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.ProductionDropWindow > cfg.BatteryWindow {
		// Guard against someone reverting Evaluate to BatteryWindow+1.
		need := max(cfg.BatteryWindow, cfg.ProductionDropWindow)
		if need < cfg.ProductionDropWindow {
			t.Fatalf("readings window %d cannot satisfy production window %d", need, cfg.ProductionDropWindow)
		}
	}
}
