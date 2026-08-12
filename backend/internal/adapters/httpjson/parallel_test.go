package httpjson

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMapBounded_PreservesInputOrder(t *testing.T) {
	// Order is what pairs a reading back to the plant it came from, so a
	// concurrent implementation that returns completion order would silently
	// mis-attribute telemetry across sites.
	items := []int{0, 1, 2, 3, 4, 5, 6, 7}
	got := MapBounded(context.Background(), items, 4, func(_ context.Context, n int) int {
		// Sleep inversely to position so completion order is the reverse of
		// input order; a naive append-on-finish would fail this.
		time.Sleep(time.Duration(len(items)-n) * time.Millisecond)
		return n * 10
	})

	for i, v := range got {
		if v != i*10 {
			t.Fatalf("index %d = %d, want %d (results out of order)", i, v, i*10)
		}
	}
}

func TestMapBounded_RespectsLimit(t *testing.T) {
	const limit = 3
	var mu sync.Mutex
	live, peak := 0, 0

	MapBounded(context.Background(), make([]int, 40), limit, func(_ context.Context, _ int) int {
		mu.Lock()
		live++
		if live > peak {
			peak = live
		}
		mu.Unlock()

		time.Sleep(2 * time.Millisecond)

		mu.Lock()
		live--
		mu.Unlock()
		return 0
	})

	if peak > limit {
		t.Fatalf("peak concurrency %d exceeded limit %d", peak, limit)
	}
	if peak < 2 {
		t.Fatalf("peak concurrency %d — work did not actually run in parallel", peak)
	}
}

func TestMapBounded_RunsEveryItemExactlyOnce(t *testing.T) {
	var calls atomic.Int64
	items := make([]int, 25)
	out := MapBounded(context.Background(), items, 5, func(_ context.Context, _ int) int {
		calls.Add(1)
		return 1
	})

	if calls.Load() != int64(len(items)) {
		t.Fatalf("fn ran %d times, want %d", calls.Load(), len(items))
	}
	for i, v := range out {
		if v != 1 {
			t.Fatalf("index %d not written (got %d)", i, v)
		}
	}
}

func TestMapBounded_EmptyInput(t *testing.T) {
	out := MapBounded(context.Background(), []string{}, 4, func(_ context.Context, s string) string { return s })
	if len(out) != 0 {
		t.Fatalf("len = %d, want 0", len(out))
	}
}

func TestMapBounded_ZeroLimitStillRuns(t *testing.T) {
	// A misconfigured limit must degrade to sequential, never to a deadlock
	// or a silently empty result — this runs inside the collection cycle.
	out := MapBounded(context.Background(), []int{1, 2, 3}, 0, func(_ context.Context, n int) int { return n * 2 })
	want := []int{2, 4, 6}
	for i := range want {
		if out[i] != want[i] {
			t.Fatalf("index %d = %d, want %d", i, out[i], want[i])
		}
	}
}
