package storage

import (
	"testing"
	"time"
)

// The day must be the day the INVERTERS mean. energy_today_kwh is a counter
// the vendor resets at its own local midnight, so a UTC day boundary would,
// every evening between 21:00 and midnight Nairobi, sum two different days'
// counters and label the result "today".
func TestFleetDayUsesNairobiMidnight(t *testing.T) {
	cases := []struct {
		name      string
		at        time.Time
		wantStart string
	}{
		{
			// 22:30 EAT on the 18th is 19:30 UTC on the 18th — same date
			// either way, so this one passes even with a UTC boundary.
			name:      "late evening",
			at:        time.Date(2026, 8, 18, 22, 30, 0, 0, eat),
			wantStart: "2026-08-18T00:00:00+03:00",
		},
		{
			// The one that actually discriminates: 01:30 EAT on the 19th is
			// 22:30 UTC on the 18th. A UTC day would call this the 18th.
			name:      "just after local midnight",
			at:        time.Date(2026, 8, 19, 1, 30, 0, 0, eat),
			wantStart: "2026-08-19T00:00:00+03:00",
		},
		{
			// Given in UTC, to prove the input's own zone is irrelevant.
			name:      "expressed in UTC",
			at:        time.Date(2026, 8, 18, 22, 30, 0, 0, time.UTC),
			wantStart: "2026-08-19T00:00:00+03:00",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, end := FleetDay(c.at)
			if got := start.Format(time.RFC3339); got != c.wantStart {
				t.Errorf("start = %s, want %s", got, c.wantStart)
			}
			if d := end.Sub(start); d != 24*time.Hour {
				t.Errorf("day is %s long, want 24h", d)
			}
			if !start.After(c.at.Add(-25*time.Hour)) || !end.After(c.at) {
				t.Errorf("day [%s, %s) does not contain %s", start, end, c.at)
			}
		})
	}
}

// Kenya has never observed daylight saving, so the offset must be constant
// across the year. If this ever fails, the fixed zone is the wrong tool and
// the service needs real tzdata.
func TestFleetDayOffsetIsStableAcrossTheYear(t *testing.T) {
	for _, month := range []time.Month{time.January, time.April, time.July, time.October} {
		start, _ := FleetDay(time.Date(2026, month, 15, 12, 0, 0, 0, time.UTC))
		if _, offset := start.Zone(); offset != 3*60*60 {
			t.Errorf("%s: offset %d seconds, want 10800 (UTC+3)", month, offset)
		}
	}
}
