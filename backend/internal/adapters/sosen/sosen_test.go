package sosen

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

	a := newForTest(config.SosenConfig{Username: "user@example.com", Password: "pw"})
	a.baseURL = srv.URL
	return a
}

func envelope(w http.ResponseWriter, data any) {
	json.NewEncoder(w).Encode(map[string]any{
		"code": 0, "msg": "Success", "success": true, "data": data,
	})
}

func tokenHandler(w http.ResponseWriter, r *http.Request) {
	envelope(w, map[string]any{
		"access_token": "tok-abc", "refresh_token": "ref-abc",
		"scope": "all", "token_type": "Bearer", "expires_in": 7775999,
	})
}

func TestFetchAll_OnlinePlantWithBattery(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		case r.URL.Path == "/api/v1/plants":
			envelope(w, map[string]any{
				"total": 1,
				"infos": []map[string]any{
					{"id": 299093, "name": "Misikhu Hospital", "status": 1, "pac": 3890.0, "etoday": 4.5, "etotal": 180.7, "address": "Kenya"},
				},
			})
		case r.URL.Path == "/api/v1/plant/299093/realtime":
			envelope(w, map[string]any{"pac": 3890.0, "gridPower": 12.0, "batPower": 0.0})
		case r.URL.Path == "/api/v1/plant/299093/deviceCount":
			envelope(w, map[string]any{"warning": 0, "fault": 0, "total": 1, "normal": 1, "offline": 0})
		case r.URL.Path == "/api/v1/plant/299093/inverters":
			envelope(w, map[string]any{"infos": []map[string]any{{"sn": "S123"}}})
		case r.URL.Path == "/api/v1/inverter/battery/S123/realtime":
			envelope(w, map[string]any{"soc": "60.0"}) // real API returns SOC as a string
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
	site := data[0]
	if site.BrandSiteID != "299093" {
		t.Errorf("BrandSiteID = %q, want 299093", site.BrandSiteID)
	}
	if got := deref(t, "Power", site.Power); got != 3890.0 {
		t.Errorf("Power = %v, want 3890", got)
	}
	if site.Status != models.StatusOnline {
		t.Errorf("Status = %v, want online", site.Status)
	}
	if site.SOC == nil || *site.SOC != 60.0 {
		t.Fatalf("SOC = %v, want 60.0 (parsed from string \"60.0\")", site.SOC)
	}
	if site.GridPower == nil || *site.GridPower != 12.0 {
		t.Errorf("GridPower = %v, want 12", site.GridPower)
	}
}

func TestFetchAll_OfflinePlantSkipsBattery(t *testing.T) {
	inverterCalled := false
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		case r.URL.Path == "/api/v1/plants":
			envelope(w, map[string]any{
				"infos": []map[string]any{
					{"id": 42, "name": "Dark Site", "status": 0, "pac": 0.0},
				},
			})
		case r.URL.Path == "/api/v1/plant/42/realtime":
			envelope(w, map[string]any{"pac": 0.0})
		case r.URL.Path == "/api/v1/plant/42/deviceCount":
			envelope(w, map[string]any{"warning": 0, "fault": 0, "total": 1, "normal": 0, "offline": 1})
		case r.URL.Path == "/api/v1/plant/42/inverters":
			inverterCalled = true
			envelope(w, map[string]any{"infos": []map[string]any{}}) // no inverters -> no SOC
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 || data[0].Status != models.StatusOffline {
		t.Fatalf("expected offline site, got %+v", data)
	}
	if data[0].SOC != nil {
		t.Errorf("SOC = %v, want nil (no inverters found)", data[0].SOC)
	}
	if !inverterCalled {
		t.Error("expected inverter lookup to be attempted regardless of plant status")
	}
}

func TestFetchAll_DeviceFaultEscalatesStatus(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		case r.URL.Path == "/api/v1/plants":
			envelope(w, map[string]any{
				"infos": []map[string]any{{"id": 7, "name": "Faulty", "status": 1, "pac": 100.0}},
			})
		case r.URL.Path == "/api/v1/plant/7/realtime":
			envelope(w, map[string]any{"pac": 100.0})
		case r.URL.Path == "/api/v1/plant/7/deviceCount":
			envelope(w, map[string]any{"fault": 1, "warning": 0, "total": 1, "normal": 0, "offline": 0})
		case r.URL.Path == "/api/v1/plant/7/inverters":
			envelope(w, map[string]any{"infos": []map[string]any{}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 || data[0].Status != models.StatusError {
		t.Fatalf("expected error status escalated by deviceCount.fault, got %+v", data)
	}
}

func TestFetchAll_PlantListFailure(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	})

	if _, err := a.FetchAll(t.Context()); err == nil {
		t.Fatal("expected error when plant list fetch fails")
	}
}

func TestValidateCredentials_AuthFailure(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"code": 102, "msg": "Account or password error", "success": false, "data": nil,
		})
	})

	if err := a.ValidateCredentials(t.Context()); err == nil {
		t.Fatal("expected error for rejected credentials")
	}
}

func newForTest(cfg config.SosenConfig) *Adapter {
	a := New(cfg, httpjson.Hooks{})
	a.client = httpjson.New("sosen", fastRetry(), httpjson.Hooks{})
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
