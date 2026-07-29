package storage

import "testing"

// Paging bounds are pure logic and worth testing without a database: they
// are what stops a client asking for the entire table, and an off-by-one
// here is the difference between a bounded query and a full scan.
func TestListParamsNormalize(t *testing.T) {
	cases := []struct {
		name       string
		in         ListParams
		wantLimit  int
		wantOffset int
	}{
		{"zero limit falls back", ListParams{}, defaultListLimit, 0},
		{"negative limit falls back", ListParams{Limit: -5}, defaultListLimit, 0},
		{"limit is capped", ListParams{Limit: 100000}, maxListLimit, 0},
		{"limit at the cap is kept", ListParams{Limit: maxListLimit}, maxListLimit, 0},
		{"negative offset is clamped", ListParams{Limit: 10, Offset: -20}, 10, 0},
		{"valid values pass through", ListParams{Limit: 25, Offset: 50}, 25, 50},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.in.Normalize()
			if got.Limit != tc.wantLimit {
				t.Errorf("Limit = %d, want %d", got.Limit, tc.wantLimit)
			}
			if got.Offset != tc.wantOffset {
				t.Errorf("Offset = %d, want %d", got.Offset, tc.wantOffset)
			}
		})
	}
}

func TestNormalizePreservesActiveOnly(t *testing.T) {
	if !(ListParams{ActiveOnly: true}).Normalize().ActiveOnly {
		t.Error("Normalize must not drop the ActiveOnly filter")
	}
}
