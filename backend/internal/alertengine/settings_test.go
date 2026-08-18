package alertengine

import (
	"testing"
	"time"

	"solar-monitor/internal/models"
)

func seeded() models.AlertSettings {
	return models.AlertSettings{
		ProductionDropThresholdW:      50,
		ProductionRecoverThresholdW:   150,
		ProductionDropWindowSeconds:   1800,
		ProductionDropCooldownSeconds: 7200,
		ProductionEdgeMarginSeconds:   3600,
		OfflineThresholdSeconds:       600,
		OfflineCooldownSeconds:        3600,
		FaultCooldownSeconds:          3600,
		BatteryWindowSeconds:          900,
		BatterySOCThresholdPct:        20,
		BatterySOCRecoverPct:          30,
		BatteryCooldownSeconds:        7200,
	}
}

// The row migration 0009 seeds must reproduce DefaultConfig() exactly at the
// default poll interval. If it does not, applying that migration silently
// changes every alert threshold on every existing deployment — which is the
// one thing a settings migration must never do.
func TestSeededSettingsReproduceDefaultConfig(t *testing.T) {
	base := DefaultConfig()
	got := ConfigFromSettings(seeded(), 5*time.Minute, base)

	if got != base {
		t.Errorf("seeded settings do not reproduce DefaultConfig()\n got: %+v\nwant: %+v", got, base)
	}
}

// The daytime window is deployment configuration, not alert policy, so it must
// survive the overlay untouched — otherwise loading settings would silently
// reset a non-default DAYTIME_START_HOUR back to the compiled value.
func TestConfigFromSettingsPreservesNonEditableFields(t *testing.T) {
	base := DefaultConfig()
	base.DaytimeStartHour = 7
	base.DaytimeEndMinutes = 19*60 + 15

	got := ConfigFromSettings(seeded(), 5*time.Minute, base)

	if got.DaytimeStartHour != 7 {
		t.Errorf("DaytimeStartHour = %d, want 7 (came from deployment config, not settings)", got.DaytimeStartHour)
	}
	if got.DaytimeEndMinutes != 19*60+15 {
		t.Errorf("DaytimeEndMinutes = %d, want %d", got.DaytimeEndMinutes, 19*60+15)
	}
}

// The behaviour this whole feature exists to guarantee: the wall-clock span a
// window covers must not move when the poll interval is retuned.
func TestWindowSpanSurvivesPollIntervalChange(t *testing.T) {
	s := seeded()
	for _, poll := range []time.Duration{time.Minute, 2 * time.Minute, 5 * time.Minute, 10 * time.Minute} {
		cfg := ConfigFromSettings(s, poll, DefaultConfig())
		span := time.Duration(cfg.ProductionDropWindow) * poll
		want := time.Duration(s.ProductionDropWindowSeconds) * time.Second
		if span < want {
			t.Errorf("poll=%s: production window spans %s, less than the configured %s", poll, span, want)
		}
		// Rounding up must never overshoot by a whole extra reading.
		if span >= want+poll {
			t.Errorf("poll=%s: production window spans %s, overshooting %s by a full interval", poll, span, want)
		}
	}
}

// A live swap must be visible to the next evaluation, and must not race.
func TestSetConfigSwapsLivePolicy(t *testing.T) {
	e := New(nil, nil, DefaultConfig())
	if got := e.Config().ProductionDropThresholdW; got != 50 {
		t.Fatalf("initial threshold = %v, want 50", got)
	}

	s := seeded()
	s.ProductionDropThresholdW = 75
	s.ProductionRecoverThresholdW = 225
	e.SetConfig(ConfigFromSettings(s, 5*time.Minute, DefaultConfig()))

	if got := e.Config().ProductionDropThresholdW; got != 75 {
		t.Errorf("after SetConfig threshold = %v, want 75", got)
	}
}
