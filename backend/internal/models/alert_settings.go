package models

import (
	"errors"
	"fmt"
	"time"
)

// AlertSettings is the operator-editable alert policy, exactly as stored.
//
// Durations are seconds rather than time.Duration because this type crosses
// the JSON boundary to the admin UI, and time.Duration marshals as a
// nanosecond integer — a field the browser would have to divide by 1e9 to
// make sense of. Seconds are the same on both sides.
//
// The two WINDOWS are durations here and reading counts in alertengine.Config.
// That conversion is the point of this type; see the header of
// migrations/0009_alert_settings.sql for why the stored form is the duration.
type AlertSettings struct {
	ProductionDropThresholdW      float64 `json:"production_drop_threshold_w"`
	ProductionRecoverThresholdW   float64 `json:"production_recover_threshold_w"`
	ProductionDropWindowSeconds   int     `json:"production_drop_window_seconds"`
	ProductionDropCooldownSeconds int     `json:"production_drop_cooldown_seconds"`
	ProductionEdgeMarginSeconds   int     `json:"production_edge_margin_seconds"`

	OfflineThresholdSeconds int `json:"offline_threshold_seconds"`
	OfflineCooldownSeconds  int `json:"offline_cooldown_seconds"`

	FaultCooldownSeconds int `json:"fault_cooldown_seconds"`

	BatteryWindowSeconds   int     `json:"battery_window_seconds"`
	BatterySOCThresholdPct float64 `json:"battery_soc_threshold_pct"`
	BatterySOCRecoverPct   float64 `json:"battery_soc_recover_pct"`
	BatteryCooldownSeconds int     `json:"battery_cooldown_seconds"`

	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy *string   `json:"updated_by,omitempty"`
}

// MinWindowReadings is the smallest number of readings a window may span.
//
// Two, not one. The whole hysteresis mechanism in alertengine.windowState
// rests on "every reading in the window agrees" — with a window of one, a
// single sample both raises and clears the alert, which is precisely the
// flapping the band exists to prevent. A window that collapses to one reading
// does not make the rule twitchy, it disables the safeguard.
const MinWindowReadings = 2

// Validate rejects settings that would break alerting rather than merely tune
// it. It needs the poll interval because two of the rules are only meaningful
// relative to how often data arrives.
//
// This runs on the way IN, not on the way out. A bad row that reaches the
// engine disables a rule silently — checkProductionDrop simply returns early
// when it cannot fill its window, and nothing anywhere says so.
func (s AlertSettings) Validate(pollInterval time.Duration) error {
	var errs []error
	positive := func(name string, v int) {
		if v <= 0 {
			errs = append(errs, fmt.Errorf("%s must be greater than zero", name))
		}
	}
	positive("production_drop_window_seconds", s.ProductionDropWindowSeconds)
	positive("production_drop_cooldown_seconds", s.ProductionDropCooldownSeconds)
	positive("offline_threshold_seconds", s.OfflineThresholdSeconds)
	positive("offline_cooldown_seconds", s.OfflineCooldownSeconds)
	positive("fault_cooldown_seconds", s.FaultCooldownSeconds)
	positive("battery_window_seconds", s.BatteryWindowSeconds)
	positive("battery_cooldown_seconds", s.BatteryCooldownSeconds)
	if s.ProductionEdgeMarginSeconds < 0 {
		errs = append(errs, errors.New("production_edge_margin_seconds cannot be negative"))
	}

	if s.ProductionDropThresholdW < 0 {
		errs = append(errs, errors.New("production_drop_threshold_w cannot be negative"))
	}
	// The hysteresis band. Equal thresholds are not a narrow band, they are no
	// band at all: windowState would report firing and clear off the same
	// reading set, so the rule oscillates as fast as the poll interval.
	if s.ProductionRecoverThresholdW <= s.ProductionDropThresholdW {
		errs = append(errs, errors.New(
			"production_recover_threshold_w must be greater than production_drop_threshold_w — "+
				"the gap between them is the hysteresis band that stops the alert flapping"))
	}

	inPct := func(name string, v float64) {
		if v < 0 || v > 100 {
			errs = append(errs, fmt.Errorf("%s must be between 0 and 100", name))
		}
	}
	inPct("battery_soc_threshold_pct", s.BatterySOCThresholdPct)
	inPct("battery_soc_recover_pct", s.BatterySOCRecoverPct)
	if s.BatterySOCRecoverPct <= s.BatterySOCThresholdPct {
		errs = append(errs, errors.New(
			"battery_soc_recover_pct must be greater than battery_soc_threshold_pct — "+
				"without a gap a battery trickle-charging across the threshold alerts repeatedly"))
	}

	// Windows must survive the conversion back to reading counts.
	if pollInterval > 0 {
		minSeconds := int(pollInterval.Seconds()) * MinWindowReadings
		if s.ProductionDropWindowSeconds < minSeconds {
			errs = append(errs, fmt.Errorf(
				"production_drop_window_seconds must be at least %d (%d readings at the current %s poll interval)",
				minSeconds, MinWindowReadings, pollInterval))
		}
		if s.BatteryWindowSeconds < minSeconds {
			errs = append(errs, fmt.Errorf(
				"battery_window_seconds must be at least %d (%d readings at the current %s poll interval)",
				minSeconds, MinWindowReadings, pollInterval))
		}
		// An offline threshold below the poll interval fires on every site
		// every cycle: the newest reading is already up to one interval old
		// by the time the next cycle judges it.
		if s.OfflineThresholdSeconds < int(pollInterval.Seconds())*2 {
			errs = append(errs, fmt.Errorf(
				"offline_threshold_seconds must be at least %d (twice the current %s poll interval), "+
					"or every site alerts as offline on every cycle",
				int(pollInterval.Seconds())*2, pollInterval))
		}
	}

	return errors.Join(errs...)
}

// WindowReadings converts a stored window duration into the count of
// consecutive readings alertengine actually works in.
//
// Rounds UP, so a window never covers less time than was asked for, and is
// floored at MinWindowReadings so a misconfiguration cannot disable the
// hysteresis band even if validation is ever bypassed.
func WindowReadings(windowSeconds int, pollInterval time.Duration) int {
	if pollInterval <= 0 {
		return MinWindowReadings
	}
	poll := pollInterval.Seconds()
	n := int((float64(windowSeconds) + poll - 1) / poll)
	return max(n, MinWindowReadings)
}
