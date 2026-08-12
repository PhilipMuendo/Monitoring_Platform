package httpjson

import (
	"context"
	"sync"
)

// DefaultConcurrency bounds how many per-site vendor requests an adapter runs
// at once when nothing configures it. Deliberately modest: these are someone
// else's APIs, and the installer account is shared — the goal is to stop
// fetching one site at a time, not to hammer the vendor.
const DefaultConcurrency = 6

// MapBounded applies fn to every item with at most limit goroutines running at
// once, returning results in INPUT ORDER.
//
// Adapters previously fetched per-site telemetry in a plain sequential loop,
// which made a collection cycle O(sites) in vendor round-trip latency — the
// single largest cost in the whole pipeline, and the thing that decides whether
// a 100-site fleet fits inside its poll interval. Deye is worst: two HTTP calls
// per station, serialized.
//
// Order preservation matters because a reading's position is how the caller
// pairs it back to the plant it came from in the surrounding code. Each
// goroutine writes to its own index of a pre-sized slice, so no mutex is
// needed and no result can be dropped or duplicated.
//
// fn must return a value rather than an error: every adapter already turns a
// per-site failure into an Unknown reading rather than failing the batch, and
// keeping that decision inside fn means partial failure stays the adapter's
// business rather than this helper's.
func MapBounded[T any, R any](ctx context.Context, items []T, limit int, fn func(context.Context, T) R) []R {
	out := make([]R, len(items))
	if len(items) == 0 {
		return out
	}
	if limit < 1 {
		limit = 1
	}

	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup

	for i, item := range items {
		// Acquire before starting the goroutine, so a large plant list does
		// not spawn thousands of goroutines that immediately block on the
		// semaphore. At 100 sites that is the difference between 6 live
		// goroutines and 100 parked ones.
		sem <- struct{}{}
		wg.Add(1)
		go func(i int, item T) {
			defer wg.Done()
			defer func() { <-sem }()
			out[i] = fn(ctx, item)
		}(i, item)
	}

	wg.Wait()
	return out
}
