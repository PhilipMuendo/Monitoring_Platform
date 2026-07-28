package alertengine

import (
	"testing"
	"time"
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
