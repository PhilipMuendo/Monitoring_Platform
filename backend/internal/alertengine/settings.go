package alertengine

import (
	"time"

	"solar-monitor/internal/models"
)

// ConfigFromSettings turns the stored, operator-editable policy into the
// Config the rules actually run on.
//
// THIS IS WHERE THE WINDOW UNITS CHANGE. Settings hold durations because that
// is what a human means ("half an hour of low output"); Config holds counts of
// consecutive readings because that is what windowState compares. Doing the
// conversion here, once, against the live poll interval is what stops the two
// drifting apart: retuning POLL_INTERVAL now re-derives the reading counts and
// the alert keeps covering the same wall-clock span, instead of silently
// becoming more or less sensitive.
//
// `base` supplies the fields that are NOT operator-editable — the daytime
// window, which is deployment configuration (Africa/Nairobi, from env) rather
// than alert policy. Passing the whole base Config rather than just those two
// ints means a field added to Config in future keeps its default here instead
// of silently becoming a zero value.
func ConfigFromSettings(s models.AlertSettings, pollInterval time.Duration, base Config) Config {
	cfg := base

	cfg.ProductionDropThresholdW = s.ProductionDropThresholdW
	cfg.ProductionRecoverThresholdW = s.ProductionRecoverThresholdW
	cfg.ProductionDropWindow = models.WindowReadings(s.ProductionDropWindowSeconds, pollInterval)
	cfg.ProductionDropCooldown = time.Duration(s.ProductionDropCooldownSeconds) * time.Second
	cfg.ProductionEdgeMargin = time.Duration(s.ProductionEdgeMarginSeconds) * time.Second

	cfg.OfflineThreshold = time.Duration(s.OfflineThresholdSeconds) * time.Second
	cfg.OfflineCooldown = time.Duration(s.OfflineCooldownSeconds) * time.Second

	cfg.FaultCooldown = time.Duration(s.FaultCooldownSeconds) * time.Second

	cfg.BatteryWindow = models.WindowReadings(s.BatteryWindowSeconds, pollInterval)
	cfg.BatterySOCThresholdPct = s.BatterySOCThresholdPct
	cfg.BatterySOCRecoverPct = s.BatterySOCRecoverPct
	cfg.BatteryCooldown = time.Duration(s.BatteryCooldownSeconds) * time.Second

	return cfg
}
