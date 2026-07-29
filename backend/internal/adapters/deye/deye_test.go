package deye

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"solar-monitor/internal/adapters/httpjson"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

func newTestAdapter(t *testing.T, handler http.HandlerFunc) *Adapter {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	a := newForTest(config.DeyeConfig{
		AppID:    "app-id",
		Secret:   "app-secret",
		Username: "user@example.com",
		Password: "pw",
	})
	a.baseURL = srv.URL
	return a
}

func tokenHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"accessToken": "tok-123",
		"expiresIn":   "5183999",
		"code":        "1000000",
		"msg":         "success",
	})
}

func TestFetchAll_MapsStationAndLatest(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/account/token":
			tokenHandler(w, r)
		case "/v1.0/station/list":
			json.NewEncoder(w).Encode(map[string]any{
				"stationList": []map[string]any{
					{"id": 1, "name": "Site One", "installedCapacity": 5.0, "locationAddress": "Nairobi", "connectionStatus": "NORMAL"},
					{"id": 2, "name": "Site Two", "installedCapacity": 3.0, "locationAddress": "Kampala", "connectionStatus": "ALL_OFFLINE"},
				},
				"total": 2,
			})
		case "/v1.0/station/latest":
			var body struct {
				StationID int64 `json:"stationId"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			json.NewEncoder(w).Encode(map[string]any{
				"generationPower":  1234.0,
				"consumptionPower": 500.0,
				"gridPower":        50.0,
				"batterySOC":       80.0,
				"lastUpdateTime":   1784557103.0,
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 2 {
		t.Fatalf("expected 2 sites, got %d", len(data))
	}

	byID := map[string]models.SiteData{}
	for _, d := range data {
		byID[d.BrandSiteID] = d
	}

	online := byID["1"]
	if got := deref(t, "Power", online.Power); got != 1234.0 {
		t.Errorf("Power = %v, want 1234", got)
	}
	if online.SOC == nil || *online.SOC != 80.0 {
		t.Errorf("SOC = %v, want 80", online.SOC)
	}
	if online.Status != models.StatusOnline {
		t.Errorf("Status = %v, want online (connectionStatus NORMAL)", online.Status)
	}

	offline := byID["2"]
	if offline.Status != models.StatusOffline {
		t.Errorf("Status = %v, want offline (connectionStatus ALL_OFFLINE)", offline.Status)
	}
}

func TestFetchAll_PartialOfflineMapsToWarning(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/account/token":
			tokenHandler(w, r)
		case "/v1.0/station/list":
			json.NewEncoder(w).Encode(map[string]any{
				"stationList": []map[string]any{
					{"id": 9, "name": "Partial", "connectionStatus": "PARTIAL_OFFLINE"},
				},
			})
		case "/v1.0/station/latest":
			json.NewEncoder(w).Encode(map[string]any{"generationPower": 10.0})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 || data[0].Status != models.StatusWarning {
		t.Fatalf("expected warning status, got %+v", data)
	}
}

// A telemetry failure means we could not read the station; it says
// nothing about whether the station is running. Reporting Offline here
// escalated a transient vendor 500 into a *critical* alert — the single
// most likely source of false pages in this system.
func TestFetchAll_StationLatestFailureMarksUnknownNotOffline(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/account/token":
			tokenHandler(w, r)
		case "/v1.0/station/list":
			json.NewEncoder(w).Encode(map[string]any{
				"stationList": []map[string]any{{"id": 5, "name": "Flaky"}},
			})
		case "/v1.0/station/latest":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	if data[0].Status != models.StatusUnknown {
		t.Fatalf("Status = %s, want unknown — an unreadable station must not be reported as a real outage", data[0].Status)
	}
	if data[0].Status.Alertable() {
		t.Error("unknown must not be alertable")
	}
}

func TestAuthenticate_StripsBearerPrefix(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1.0/account/token" {
			json.NewEncoder(w).Encode(map[string]any{
				"accessToken": "Bearer already-has-prefix",
				"expiresIn":   "1000",
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	})

	if err := a.ValidateCredentials(t.Context()); err != nil {
		t.Fatalf("ValidateCredentials: %v", err)
	}
	// The cache holds the stripped value, so callers can always safely do
	// "Bearer "+token without producing "Bearer Bearer ...".
	tok, err := a.tokens.Get(t.Context())
	if err != nil {
		t.Fatalf("token fetch: %v", err)
	}
	if tok != "already-has-prefix" {
		t.Errorf("token = %q, want prefix stripped", tok)
	}
}

func TestAuthenticate_RejectsEmptyToken(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"accessToken": "",
			"code":        "1000001",
			"msg":         "invalid credentials",
		})
	})

	if err := a.ValidateCredentials(t.Context()); err == nil {
		t.Fatal("expected error for empty access token")
	}
}

// /v1.0/station/latest carries no energy-today field, so every Deye site
// reported 0.0 kWh and the fleet "Energy today" tile sat at zero — 8 of the
// 12 real sites on this account are Deye. Today's yield is recovered by
// integrating the inverter's own intra-day power series from
// /v1.0/station/history (granularity 1; granularity 2 only returns
// completed days and so never includes today).
func TestFetchAll_IntegratesEnergyTodayFromHistory(t *testing.T) {
	var historyCalls int
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/account/token":
			tokenHandler(w, r)
		case "/v1.0/station/list":
			json.NewEncoder(w).Encode(map[string]any{
				"stationList": []map[string]any{
					{"id": 1, "name": "Site One", "installedCapacity": 5.0, "regionTimezone": "Africa/Nairobi", "connectionStatus": "NORMAL"},
				},
				"total": 1,
			})
		case "/v1.0/station/latest":
			json.NewEncoder(w).Encode(map[string]any{
				"generationPower": 2000.0,
				"batterySOC":      80.0,
				"lastUpdateTime":  1784557103.0,
			})
		case "/v1.0/station/history":
			historyCalls++
			// Flat 2 kW across two hours = 4 kWh, then a four-hour comms
			// gap that must not be bridged.
			base := 1785300000.0
			json.NewEncoder(w).Encode(map[string]any{
				"stationDataItems": []map[string]any{
					{"generationPower": 2000.0, "timeStamp": base},
					{"generationPower": 2000.0, "timeStamp": base + 3600},
					{"generationPower": 2000.0, "timeStamp": base + 7200},
					{"generationPower": 2000.0, "timeStamp": base + 7200 + 4*3600},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	if historyCalls != 1 {
		t.Errorf("station/history called %d times, want 1 per station", historyCalls)
	}
	if got := deref(t, "EnergyToday", data[0].EnergyToday); got < 3.99 || got > 4.01 {
		t.Errorf("EnergyToday = %.3f kWh, want ~4.0 (the 4h gap must not be bridged)", got)
	}
}

// A history failure must not cost us the site's live telemetry.
func TestFetchAll_HistoryFailureKeepsLiveReading(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/account/token":
			tokenHandler(w, r)
		case "/v1.0/station/list":
			json.NewEncoder(w).Encode(map[string]any{
				"stationList": []map[string]any{
					{"id": 1, "name": "Site One", "installedCapacity": 5.0, "connectionStatus": "NORMAL"},
				},
				"total": 1,
			})
		case "/v1.0/station/latest":
			json.NewEncoder(w).Encode(map[string]any{
				"generationPower": 1500.0,
				"batterySOC":      42.0,
				"lastUpdateTime":  1784557103.0,
			})
		default: // history 500s
			w.WriteHeader(http.StatusInternalServerError)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if got := deref(t, "Power", data[0].Power); got != 1500 {
		t.Errorf("Power = %v, want the live reading 1500 despite the history failure", got)
	}
	if data[0].Status != models.StatusOnline {
		t.Errorf("Status = %s, want online", data[0].Status)
	}
	if data[0].EnergyToday != nil {
		t.Errorf("EnergyToday = %v, want nil when history is unavailable — an unmeasured day is not a zero-kWh day", *data[0].EnergyToday)
	}
}

// newForTest builds an adapter with no metrics hooks and a fast retry
// policy, so a test that exercises a failure path doesn't spend the
// production backoff waiting between attempts.
func newForTest(cfg config.DeyeConfig) *Adapter {
	a := New(cfg, httpjson.Hooks{})
	a.client = httpjson.New("deye", fastRetry(), httpjson.Hooks{})
	return a
}

func fastRetry() httpjson.Config {
	c := httpjson.Defaults()
	c.BaseBackoff = time.Millisecond
	c.MaxBackoff = 2 * time.Millisecond
	return c
}

// deref reads an optional telemetry channel for assertions. Every channel
// on SiteData is a pointer now, so that "the vendor did not report this"
// is representable rather than being flattened into a confident zero.
func deref(t *testing.T, name string, v *float64) float64 {
	t.Helper()
	if v == nil {
		t.Fatalf("%s was nil; expected a reported value", name)
	}
	return *v
}
