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
