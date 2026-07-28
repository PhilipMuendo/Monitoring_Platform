package deye

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

func newTestAdapter(t *testing.T, handler http.HandlerFunc) *Adapter {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	a := New(config.DeyeConfig{
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
	if online.Power != 1234.0 {
		t.Errorf("Power = %v, want 1234", online.Power)
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

func TestFetchAll_StationLatestFailureMarksOffline(t *testing.T) {
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
	if len(data) != 1 || data[0].Status != models.StatusOffline {
		t.Fatalf("expected offline fallback on latest-fetch failure, got %+v", data)
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
	if a.accessToken != "already-has-prefix" {
		t.Errorf("accessToken = %q, want prefix stripped", a.accessToken)
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
