package sosen

import (
	"encoding/json"
	"math"
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
	// Sosen's +12 means 12 W flowing OUT to the grid, so the normalized
	// value is -12 under the platform's +import/-export convention. The
	// fixture's own numbers are what pin this down: the adapter derives
	// load = pac - gridPower = 3878, and 3890 W of PV only balances
	// 3878 W of load if the remaining 12 W is exported.
	if got := deref(t, "GridPower", site.GridPower); got != -12.0 {
		t.Errorf("GridPower = %v, want -12 (vendor +12 = export -> -12 importing-positive)", got)
	}
	if got := deref(t, "LoadPower", site.LoadPower); got != 3878.0 {
		t.Errorf("LoadPower = %v, want 3878 (pac - gridPower)", got)
	}
}

// A plant drawing from the grid: the case that was rendering backwards on
// the dashboard. Sosen reports gridPower negative for import, so the
// normalized value must come out positive.
func TestFetchAll_GridImportIsPositive(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		case r.URL.Path == "/api/v1/plants":
			envelope(w, map[string]any{
				"total": 1,
				"infos": []map[string]any{
					{"id": 192795, "name": "Oakfund", "status": 1, "pac": 0.0, "etoday": 0.0, "etotal": 0.0, "address": "Nairobi"},
				},
			})
		case r.URL.Path == "/api/v1/plant/192795/realtime":
			// Observed live: no PV, idle battery, 930 W load served entirely
			// from the grid.
			envelope(w, map[string]any{"pac": 0.0, "gridPower": -930.0, "batPower": 0.0})
		case r.URL.Path == "/api/v1/plant/192795/deviceCount":
			envelope(w, map[string]any{"warning": 0, "fault": 0, "total": 1, "normal": 1, "offline": 0})
		case r.URL.Path == "/api/v1/plant/192795/inverters":
			envelope(w, map[string]any{"infos": []map[string]any{{"sn": "S999"}}})
		case r.URL.Path == "/api/v1/inverter/battery/S999/realtime":
			envelope(w, map[string]any{"soc": "100.0"})
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
	if got := deref(t, "GridPower", data[0].GridPower); got != 930.0 {
		t.Errorf("GridPower = %v, want 930 (importing is positive)", got)
	}
	if got := deref(t, "LoadPower", data[0].LoadPower); got != 930.0 {
		t.Errorf("LoadPower = %v, want 930 (all load served from grid)", got)
	}
}

// Some plants omit gridPower from the realtime payload entirely (observed
// live on SARAH BULOBA and MUSEVE SHRINE KITUI). Absent must stay absent:
// reporting 0 would put a confident "0 W" on the dashboard for a quantity
// the portal never measured, and load is derived from gridPower so it has
// to drop out with it.
func TestFetchAll_AbsentGridPowerStaysNil(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		case r.URL.Path == "/api/v1/plants":
			envelope(w, map[string]any{
				"total": 1,
				"infos": []map[string]any{
					{"id": 5150, "name": "SARAH BULOBA", "status": 1, "pac": 0.0, "etoday": 0.0, "etotal": 0.0, "address": "Division A"},
				},
			})
		case r.URL.Path == "/api/v1/plant/5150/realtime":
			// No gridPower key at all — the shape this test exists to pin.
			envelope(w, map[string]any{"pac": 0.0, "batPower": 0.0})
		case r.URL.Path == "/api/v1/plant/5150/deviceCount":
			envelope(w, map[string]any{"warning": 0, "fault": 0, "total": 1, "normal": 1, "offline": 0})
		case r.URL.Path == "/api/v1/plant/5150/inverters":
			envelope(w, map[string]any{"infos": []map[string]any{{"sn": "S5150"}}})
		case r.URL.Path == "/api/v1/inverter/battery/S5150/realtime":
			envelope(w, map[string]any{"soc": "50.0"})
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
	if data[0].GridPower != nil {
		t.Errorf("GridPower = %v, want nil (key absent from payload)", *data[0].GridPower)
	}
	if data[0].LoadPower != nil {
		t.Errorf("LoadPower = %v, want nil (derived from an absent gridPower)", *data[0].LoadPower)
	}
}

// A measured zero must round-trip as +0, not -0: negating it is what the
// import/export normalization does, and -0 survives into Postgres and the
// JSON payload where it reads as a nonsense "-0 W".
func TestFetchAll_MeasuredZeroGridIsNotNegativeZero(t *testing.T) {
	a := newTestAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/token":
			tokenHandler(w, r)
		case r.URL.Path == "/api/v1/plants":
			envelope(w, map[string]any{
				"total": 1,
				"infos": []map[string]any{
					{"id": 77, "name": "Balanced", "status": 1, "pac": 0.0, "etoday": 0.0, "etotal": 0.0},
				},
			})
		case r.URL.Path == "/api/v1/plant/77/realtime":
			envelope(w, map[string]any{"pac": 0.0, "gridPower": 0.0, "batPower": 0.0})
		case r.URL.Path == "/api/v1/plant/77/deviceCount":
			envelope(w, map[string]any{"warning": 0, "fault": 0, "total": 1, "normal": 1, "offline": 0})
		case r.URL.Path == "/api/v1/plant/77/inverters":
			envelope(w, map[string]any{"infos": []map[string]any{{"sn": "S77"}}})
		case r.URL.Path == "/api/v1/inverter/battery/S77/realtime":
			envelope(w, map[string]any{"soc": "50.0"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	got := deref(t, "GridPower", data[0].GridPower)
	if math.Signbit(got) {
		t.Errorf("GridPower = %v (negative zero), want +0", got)
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
