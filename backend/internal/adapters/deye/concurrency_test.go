package deye

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"solar-monitor/internal/adapters/httpjson"
	"solar-monitor/internal/config"
)

// Deye is the worst per-site case in the fleet: two HTTP round trips per
// station (latest telemetry, then day energy). Fetched one station at a time,
// a collection cycle is O(stations) in vendor latency, which is what decides
// whether a 100-site fleet fits inside its poll interval.
//
// These tests pin that behaviour with an artificially slow mock server, which
// measures the change deterministically rather than against a live vendor
// whose latency and failure modes move between runs.

const (
	stationCount = 12
	perCallDelay = 40 * time.Millisecond
	callsPerSite = 2 // /station/latest + /station/history
)

func slowStationsAdapter(t *testing.T) *Adapter {
	t.Helper()
	return newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/account/token":
			tokenHandler(w, r)
			return
		case "/v1.0/station/list":
			list := make([]map[string]any, 0, stationCount)
			for i := 1; i <= stationCount; i++ {
				list = append(list, map[string]any{
					"id": i, "name": "Site", "installedCapacity": 5.0,
					"locationAddress": "Nairobi", "connectionStatus": "NORMAL",
				})
			}
			json.NewEncoder(w).Encode(map[string]any{"stationList": list, "total": stationCount})
			return
		}

		// Every per-station call pays the delay.
		time.Sleep(perCallDelay)
		switch r.URL.Path {
		case "/v1.0/station/latest":
			json.NewEncoder(w).Encode(map[string]any{"generationPower": 1000.0})
		case "/v1.0/station/history":
			json.NewEncoder(w).Encode(map[string]any{"stationDataItems": []map[string]any{{"generationValue": 3.5}}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func TestFetchAll_FetchesStationsConcurrently(t *testing.T) {
	a := slowStationsAdapter(t).WithConcurrency(6)

	start := time.Now()
	out, err := a.FetchAll(context.Background())
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(out) != stationCount {
		t.Fatalf("got %d readings, want %d", len(out), stationCount)
	}

	sequential := time.Duration(stationCount*callsPerSite) * perCallDelay
	// Six-wide should land near a sixth of sequential. Half is a deliberately
	// loose bound: the point is to catch a regression back to serial fetching,
	// not to assert a precise speedup on a shared CI machine.
	if elapsed > sequential/2 {
		t.Fatalf("FetchAll took %v; sequential would be ~%v — fetches appear serialized", elapsed, sequential)
	}
	t.Logf("%d stations x %d calls: %v (sequential would be ~%v)", stationCount, callsPerSite, elapsed, sequential)
}

func TestFetchAll_ConcurrentResultsStayInStationOrder(t *testing.T) {
	// Order is how the collector pairs a reading back to its station, so a
	// concurrent fetch that returned completion order would mis-attribute
	// telemetry across sites — silently, and only under load.
	a := slowStationsAdapter(t).WithConcurrency(6)

	out, err := a.FetchAll(context.Background())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	for i, d := range out {
		want := itoa(i + 1)
		if d.BrandSiteID != want {
			t.Fatalf("index %d has BrandSiteID %q, want %q — results out of order", i, d.BrandSiteID, want)
		}
	}
}

func TestWithConcurrency_IgnoresNonPositive(t *testing.T) {
	// A misconfigured COLLECTOR_MAX_CONCURRENCY must not wedge the cycle.
	a := New(config.DeyeConfig{}, httpjson.Hooks{})
	before := a.concurrency
	if got := a.WithConcurrency(0).concurrency; got != before {
		t.Fatalf("WithConcurrency(0) changed concurrency to %d, want %d", got, before)
	}
	if got := a.WithConcurrency(-5).concurrency; got != before {
		t.Fatalf("WithConcurrency(-5) changed concurrency to %d, want %d", got, before)
	}
	if got := a.WithConcurrency(4).concurrency; got != 4 {
		t.Fatalf("WithConcurrency(4) = %d, want 4", got)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
