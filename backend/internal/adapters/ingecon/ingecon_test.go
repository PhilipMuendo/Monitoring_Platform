package ingecon

import (
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

// newTestServer builds an httptest server that serves the given path->JSON
// body map, gzip-encoding every response and requiring the X-API-KEY header,
// mirroring the real Ingecon API's documented contract.
func newTestServer(t *testing.T, key string, responses map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-KEY") != key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body, ok := responses[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(http.StatusOK)
		gz := gzip.NewWriter(w)
		defer gz.Close()
		gz.Write([]byte(body))
	}))
}

func TestFetchAll_PVPlant(t *testing.T) {
	today := time.Now().Format("20060102")
	plantsBody := `[{"id":"plant-1","name":"Test PV","location":"Nairobi","enabled":true,"plantTypeId":"pv"}]`
	pvBody := `[
		{"SN":"INV1","BoardId":"B1","DateTime":"2026-07-28T10:00:00","Pac":1000,"alarms":"0000000000000000","EInjection":5.5},
		{"SN":"INV2","BoardId":"B1","DateTime":"2026-07-28T10:00:00","Pac":500,"alarms":"0000000000000000","EInjection":2.5},
		{"SN":"INV1","BoardId":"B1","DateTime":"2026-07-28T09:45:00","Pac":900,"alarms":"0000000000000000","EInjection":5.0}
	]`
	presenceBody := `[{"boardId":"B1","presence":{"connected":true}}]`

	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants":                                     plantsBody,
		"/api/ingecon/samplesv2/plant/plant-1/date/" + today:    pvBody,
		"/api/presence/plant/plant-1":                           presenceBody,
	})
	defer srv.Close()

	a := New(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	site := data[0]
	if site.BrandSiteID != "plant-1" {
		t.Errorf("BrandSiteID = %q, want plant-1", site.BrandSiteID)
	}
	// Only the latest DateTime group (10:00) should be summed: 1000 + 500.
	if site.Power != 1500 {
		t.Errorf("Power = %v, want 1500 (sum of latest-timestamp inverters only)", site.Power)
	}
	if site.EnergyToday != 8 {
		t.Errorf("EnergyToday = %v, want 8 (5.5+2.5)", site.EnergyToday)
	}
	if site.Status != models.StatusOnline {
		t.Errorf("Status = %v, want online", site.Status)
	}
}

func TestFetchAll_SCPlant(t *testing.T) {
	today := time.Now().Format("20060102")
	plantsBody := `[{"id":"plant-2","name":"Test SC","location":"Kampala","enabled":true,"plantTypeId":"sc"}]`
	scBody := `[
		{"soc":50,"vBat":48,"dateTime":"2026-07-28T09:00:00","pvGeneration":100,"fromGridToConsumption":10,"totalConsumption":80},
		{"soc":55,"vBat":49,"dateTime":"2026-07-28T09:15:00","pvGeneration":200,"fromGridToConsumption":20,"totalConsumption":90}
	]`
	presenceBody := `[{"boardId":"B2","presence":{"connected":true}}]`

	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants":                                plantsBody,
		"/api/ems/samples/plant/plant-2/date/" + today:      scBody,
		"/api/presence/plant/plant-2":                       presenceBody,
	})
	defer srv.Close()

	a := New(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	site := data[0]
	// Must use the LAST sample (09:15), not the first.
	if site.Power != 200 {
		t.Errorf("Power = %v, want 200 (last sample)", site.Power)
	}
	if site.SOC == nil || *site.SOC != 55 {
		t.Errorf("SOC = %v, want 55", site.SOC)
	}
	if site.GridPower == nil || *site.GridPower != 20 {
		t.Errorf("GridPower = %v, want 20", site.GridPower)
	}
}

func TestFetchAll_DisabledPlantSkipped(t *testing.T) {
	plantsBody := `[{"id":"plant-3","name":"Disabled","location":"x","enabled":false,"plantTypeId":"pv"}]`
	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants": plantsBody,
	})
	defer srv.Close()

	a := New(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("expected disabled plant to be skipped, got %d sites", len(data))
	}
}

func TestFetchAll_TelemetryErrorMarksOffline(t *testing.T) {
	today := time.Now().Format("20060102")
	plantsBody := `[{"id":"plant-4","name":"Broken","location":"x","enabled":true,"plantTypeId":"pv"}]`
	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants": plantsBody,
		// no telemetry response registered -> 404 from the test server
	})
	defer srv.Close()
	_ = today

	a := New(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 || data[0].Status != models.StatusOffline {
		t.Fatalf("expected 1 offline site on telemetry failure, got %+v", data)
	}
}

func TestValidateCredentials_MissingKey(t *testing.T) {
	a := New(config.IngeconConfig{APIKey: "", BaseURL: "http://example.invalid"})
	if err := a.ValidateCredentials(t.Context()); err == nil {
		t.Fatal("expected error for missing API key")
	}
}

func TestValidateCredentials_WrongKeyRejected(t *testing.T) {
	srv := newTestServer(t, "correct-key", map[string]string{
		"/api/users/plants": `[]`,
	})
	defer srv.Close()

	a := New(config.IngeconConfig{APIKey: "wrong-key", BaseURL: srv.URL})
	if err := a.ValidateCredentials(t.Context()); err == nil {
		t.Fatal("expected error for wrong API key")
	}
}
