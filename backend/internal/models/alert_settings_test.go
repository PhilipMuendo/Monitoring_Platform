package models

import (
	"strings"
	"testing"
	"time"
)

func valid() AlertSettings {
	return AlertSettings{
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

const poll = 5 * time.Minute

// The seeded row in migration 0009 must be accepted by the same validation the
// API applies, or the very first Save from the admin UI would fail on values
// the system has been running on all along.
func TestSeededDefaultsAreValid(t *testing.T) {
	if err := valid().Validate(poll); err != nil {
		t.Fatalf("seeded defaults rejected: %v", err)
	}
}

func TestValidateRejects(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*AlertSettings)
		want string
	}{
		{"equal production thresholds", func(s *AlertSettings) { s.ProductionRecoverThresholdW = s.ProductionDropThresholdW }, "hysteresis band"},
		{"inverted production thresholds", func(s *AlertSettings) { s.ProductionRecoverThresholdW = 10 }, "hysteresis band"},
		{"equal battery thresholds", func(s *AlertSettings) { s.BatterySOCRecoverPct = s.BatterySOCThresholdPct }, "trickle-charging"},
		{"soc over 100", func(s *AlertSettings) { s.BatterySOCThresholdPct = 120 }, "between 0 and 100"},
		{"negative soc", func(s *AlertSettings) { s.BatterySOCRecoverPct = -1 }, "between 0 and 100"},
		{"zero production window", func(s *AlertSettings) { s.ProductionDropWindowSeconds = 0 }, "greater than zero"},
		{"zero battery cooldown", func(s *AlertSettings) { s.BatteryCooldownSeconds = 0 }, "greater than zero"},
		{"negative edge margin", func(s *AlertSettings) { s.ProductionEdgeMarginSeconds = -1 }, "cannot be negative"},
		// A window shorter than two polls collapses to a single reading, which
		// disables the hysteresis band entirely.
		{"production window under two polls", func(s *AlertSettings) { s.ProductionDropWindowSeconds = 300 }, "at least 600"},
		{"battery window under two polls", func(s *AlertSettings) { s.BatteryWindowSeconds = 299 }, "at least 600"},
		{"offline threshold under two polls", func(s *AlertSettings) { s.OfflineThresholdSeconds = 400 }, "every site alerts as offline"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := valid()
			tt.mut(&s)
			err := s.Validate(poll)
			if err == nil {
				t.Fatalf("Validate accepted %s", tt.name)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("Validate error = %q, want it to mention %q", err, tt.want)
			}
		})
	}
}

// Every problem should be reported at once — an operator fixing a form one
// rejected field per round trip is the worst version of this UI.
func TestValidateReportsEveryProblemTogether(t *testing.T) {
	s := valid()
	s.ProductionRecoverThresholdW = 0
	s.BatterySOCRecoverPct = 0
	s.FaultCooldownSeconds = 0
	err := s.Validate(poll)
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, want := range []string{"hysteresis band", "trickle-charging", "fault_cooldown_seconds"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("joined error %q missing %q", err, want)
		}
	}
}

func TestWindowReadings(t *testing.T) {
	tests := []struct {
		seconds int
		poll    time.Duration
		want    int
	}{
		// The defaults, at the poll interval they were designed against:
		// these must reproduce DefaultConfig's 6 and 3 exactly.
		{1800, 5 * time.Minute, 6},
		{900, 5 * time.Minute, 3},
		// The whole point: halving the poll interval keeps the same wall-clock
		// window by doubling the reading count, instead of silently halving
		// the time the rule covers.
		{1800, 150 * time.Second, 12},
		{1800, 10 * time.Minute, 3},
		// Rounds UP, so a window never covers less than was asked for.
		{1801, 5 * time.Minute, 7},
		{1, 5 * time.Minute, MinWindowReadings},
		// Floored, so even a bypassed validation cannot disable hysteresis.
		{0, 5 * time.Minute, MinWindowReadings},
		{1800, 0, MinWindowReadings},
	}
	for _, tt := range tests {
		if got := WindowReadings(tt.seconds, tt.poll); got != tt.want {
			t.Errorf("WindowReadings(%d, %s) = %d, want %d", tt.seconds, tt.poll, got, tt.want)
		}
	}
}
