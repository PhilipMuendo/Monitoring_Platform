package ingecon

import (
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"solar-monitor/internal/adapters/httpjson"
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
	today := plantToday("Africa/Nairobi")
	plantsBody := `[{"id":"plant-1","name":"Test PV","location":"Nairobi","timezone":"Africa/Nairobi","enabled":true,"plantTypeId":"pv","presence":{"connected":true}}]`
	pvBody := `[
		{"SN":"INV1","BoardId":"B1","DateTime":"2026-07-28T10:00:00","Pac":1000,"alarms":"0000000000000000","EInjection":5.5},
		{"SN":"INV2","BoardId":"B1","DateTime":"2026-07-28T10:00:00","Pac":500,"alarms":"0000000000000000","EInjection":2.5},
		{"SN":"INV1","BoardId":"B1","DateTime":"2026-07-28T09:45:00","Pac":900,"alarms":"0000000000000000","EInjection":5.0}
	]`
	presenceBody := `[{"boardId":"B1","presence":{"connected":true}}]`

	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants": plantsBody,
		"/api/ingecon/samplesv2/plant/plant-1/date/" + today: pvBody,
		"/api/presence/plant/plant-1":                        presenceBody,
	})
	defer srv.Close()

	a := newForTest(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
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
	if got := deref(t, "Power", site.Power); got != 1500 {
		t.Errorf("Power = %v, want 1500 (sum of latest-timestamp inverters only)", got)
	}
	if got := deref(t, "EnergyToday", site.EnergyToday); got != 8 {
		t.Errorf("EnergyToday = %v, want 8 (5.5+2.5)", got)
	}
	if site.Status != models.StatusOnline {
		t.Errorf("Status = %v, want online", site.Status)
	}
}

func TestFetchAll_SCPlant(t *testing.T) {
	today := plantToday("Africa/Kampala")
	plantsBody := `[{"id":"plant-2","name":"Test SC","location":"Kampala","timezone":"Africa/Kampala","enabled":true,"plantTypeId":"sc","presence":{"connected":true}}]`
	scBody := `[
		{"soc":50,"vBat":48,"dateTime":"2026-07-28T09:00:00","pvGeneration":100,"fromGridToConsumption":10,"totalConsumption":80},
		{"soc":55,"vBat":49,"dateTime":"2026-07-28T09:15:00","pvGeneration":200,"fromGridToConsumption":20,"totalConsumption":90}
	]`
	presenceBody := `[{"boardId":"B2","presence":{"connected":true}}]`

	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants":                            plantsBody,
		"/api/ems/samples/plant/plant-2/date/" + today: scBody,
		"/api/presence/plant/plant-2":                  presenceBody,
	})
	defer srv.Close()

	a := newForTest(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	site := data[0]
	// Must use the LAST sample (09:15), not the first.
	if got := deref(t, "Power", site.Power); got != 200 {
		t.Errorf("Power = %v, want 200 (last sample)", got)
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

	a := newForTest(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("expected disabled plant to be skipped, got %d sites", len(data))
	}
}

// Same contract as the Deye case: a sample-endpoint failure is a gap in
// our knowledge, not an observation of the plant.
func TestFetchAll_TelemetryErrorMarksUnknownNotOffline(t *testing.T) {
	today := plantToday("Africa/Nairobi")
	plantsBody := `[{"id":"plant-4","name":"Broken","location":"x","timezone":"Africa/Nairobi","enabled":true,"plantTypeId":"pv","presence":{"connected":true}}]`
	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants": plantsBody,
		// no telemetry response registered -> 404 from the test server
	})
	defer srv.Close()
	_ = today

	a := newForTest(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	if data[0].Status != models.StatusUnknown {
		t.Fatalf("Status = %s, want unknown on telemetry failure", data[0].Status)
	}
	if data[0].Status.Alertable() {
		t.Error("unknown must not be alertable")
	}
}

func TestValidateCredentials_MissingKey(t *testing.T) {
	a := newForTest(config.IngeconConfig{APIKey: "", BaseURL: "http://example.invalid"})
	if err := a.ValidateCredentials(t.Context()); err == nil {
		t.Fatal("expected error for missing API key")
	}
}

func TestValidateCredentials_WrongKeyRejected(t *testing.T) {
	srv := newTestServer(t, "correct-key", map[string]string{
		"/api/users/plants": `[]`,
	})
	defer srv.Close()

	a := newForTest(config.IngeconConfig{APIKey: "wrong-key", BaseURL: srv.URL})
	if err := a.ValidateCredentials(t.Context()); err == nil {
		t.Fatal("expected error for wrong API key")
	}
}

// Sample stamps carry no zone and are plant-local. Parsing them as UTC put
// every EAT reading three hours in the future, which silently disabled the
// alert engine's staleness check (time.Since went negative), made the UI
// report "last seen 1m ago" for long-dead plants, and left a three-hour
// hole at the right edge of every history chart.
func TestSampleTimestampsAreParsedInPlantTimezone(t *testing.T) {
	got, ok := parseSampleTime("2026-07-29T11:15:00", "Africa/Nairobi")
	if !ok {
		t.Fatal("parseSampleTime failed on a well-formed stamp")
	}
	want := time.Date(2026, 7, 29, 8, 15, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("11:15 EAT parsed to %s, want %s", got.UTC(), want)
	}
	if _, offset := got.Zone(); offset != 3*60*60 {
		t.Errorf("zone offset = %ds, want 10800 (UTC+3)", offset)
	}
}

func TestSampleTimeFallsBackToUTCOnUnknownZone(t *testing.T) {
	got, ok := parseSampleTime("2026-07-29T11:15:00", "Not/AZone")
	if !ok {
		t.Fatal("expected a parse even with an unusable timezone")
	}
	if !got.Equal(time.Date(2026, 7, 29, 11, 15, 0, 0, time.UTC)) {
		t.Errorf("unknown zone should fall back to UTC, got %s", got)
	}
}

func TestIntegrateEnergySkipsLongGaps(t *testing.T) {
	base := time.Date(2026, 7, 29, 6, 0, 0, 0, time.UTC)
	at := func(mins int) time.Time { return base.Add(time.Duration(mins) * time.Minute) }

	// A flat 1000 W for one hour is exactly 1 kWh.
	kwh := integrateEnergyKWh(
		[]time.Time{at(0), at(30), at(60)},
		[]float64{1000, 1000, 1000},
	)
	if kwh < 0.999 || kwh > 1.001 {
		t.Errorf("flat 1kW for 1h integrated to %.4f kWh, want 1.0", kwh)
	}

	// A four-hour comms gap must not be bridged with an interpolated ramp.
	withGap := integrateEnergyKWh(
		[]time.Time{at(0), at(30), at(30 + 240)},
		[]float64{1000, 1000, 1000},
	)
	if withGap > 0.51 {
		t.Errorf("gap was bridged: got %.4f kWh, want only the 0.5 kWh before it", withGap)
	}
}

// A plant whose board is disconnected must not be shown as offline *and*
// generating: the last sample's power is a historical value, not a live one.
func TestDisconnectedPlantReportsOfflineWithoutLivePower(t *testing.T) {
	today := plantToday("Africa/Nairobi")
	plantsBody := `[{"id":"plant-5","name":"Down","location":"x","timezone":"Africa/Nairobi","enabled":true,"plantTypeId":"sc","presence":{"connected":false,"lastLog":365405}}]`
	scBody := `[
		{"board":"B5","dateTime":"2026-07-29T09:00:00","soc":35,"vBat":357,"pvGeneration":1000,"fromGridToConsumption":20,"totalConsumption":200},
		{"board":"B5","dateTime":"2026-07-29T10:00:00","soc":35,"vBat":357,"pvGeneration":1000,"fromGridToConsumption":20,"totalConsumption":200}
	]`

	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants":                            plantsBody,
		"/api/ems/samples/plant/plant-5/date/" + today: scBody,
	})
	defer srv.Close()

	a := newForTest(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 site, got %d", len(data))
	}
	d := data[0]
	if d.Status != models.StatusOffline {
		t.Errorf("Status = %s, want offline", d.Status)
	}
	if d.Power != nil {
		t.Errorf("Power = %v, want nil for a disconnected board — the last sample is history, not a live value", *d.Power)
	}
	if d.GridPower != nil || d.LoadPower != nil {
		t.Errorf("instantaneous channels should be cleared, got grid=%v load=%v", d.GridPower, d.LoadPower)
	}
	// The day's yield is a total, not a snapshot, so it survives: 1 kW held
	// across the hour between the two samples.
	if got := deref(t, "EnergyToday", d.EnergyToday); got < 0.99 || got > 1.01 {
		t.Errorf("EnergyToday = %.3f kWh, want ~1.0 (it stays valid for hours the plant did run)", got)
	}
}

// The SC endpoint has no energy register, so today's yield is integrated
// from the day's samples we already fetch.
func TestSCPlantReportsIntegratedEnergyToday(t *testing.T) {
	today := plantToday("Africa/Nairobi")
	plantsBody := `[{"id":"plant-6","name":"Yield","location":"x","timezone":"Africa/Nairobi","enabled":true,"plantTypeId":"sc","presence":{"connected":true}}]`
	scBody := `[
		{"board":"B6","dateTime":"2026-07-29T08:00:00","soc":50,"vBat":360,"pvGeneration":0,"totalConsumption":0},
		{"board":"B6","dateTime":"2026-07-29T09:00:00","soc":55,"vBat":360,"pvGeneration":2000,"totalConsumption":0},
		{"board":"B6","dateTime":"2026-07-29T10:00:00","soc":60,"vBat":360,"pvGeneration":2000,"totalConsumption":0}
	]`

	srv := newTestServer(t, "test-key", map[string]string{
		"/api/users/plants":                            plantsBody,
		"/api/ems/samples/plant/plant-6/date/" + today: scBody,
	})
	defer srv.Close()

	a := newForTest(config.IngeconConfig{APIKey: "test-key", BaseURL: srv.URL})
	data, err := a.FetchAll(t.Context())
	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	// Trapezoid: (0+2000)/2 * 1h + (2000+2000)/2 * 1h = 3000 Wh.
	if got := deref(t, "EnergyToday", data[0].EnergyToday); got < 2.99 || got > 3.01 {
		t.Errorf("EnergyToday = %.3f kWh, want ~3.0", got)
	}
}

func newForTest(cfg config.IngeconConfig) *Adapter {
	a := New(cfg, httpjson.Hooks{})
	a.client = httpjson.New("ingecon", fastRetry(), httpjson.Hooks{})
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
