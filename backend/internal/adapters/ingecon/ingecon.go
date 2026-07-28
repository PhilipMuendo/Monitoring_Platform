// Package ingecon implements models.BrandAdapter against the real Ingecon
// SUN Monitor Web API, per Ingeteam's official spec
// "AAA0060ICB01__V1.19.ISMDataConsumer" (INGECON SUN Monitor API
// Specification). Unlike the earlier placeholder version of this file, every
// endpoint, header, and field name below is taken directly from that
// document — not guessed.
//
// Key facts from the spec that shape this file:
//   - Auth is a single "X-API-KEY" header (not OAuth/Bearer).
//   - Every request must send "Accept-Encoding: gzip" or it is rejected;
//     the response body then arrives gzip-compressed and must be decoded
//     manually (Go's transport won't auto-decompress once the caller sets
//     Accept-Encoding itself).
//   - The service enforces a hard rate limit: max 20 distinct requests/min
//     and max 10 identical requests/min, returning 429 past that. A fleet
//     poll cycle touching many plants must throttle itself accordingly.
//   - There is no "latest telemetry" endpoint. Telemetry is fetched by date
//     (YYYYMMDD) and the most recent sample in that day's data is used.
//   - A plant's "plantTypeId" ("pv" or "sc") determines which telemetry
//     endpoint applies: "pv" plants return one row per inverter per
//     15-minute sample; "sc" (self-consumption) plants return one
//     already-aggregated plant-level row per sample.
package ingecon

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

// maxRequestsPerMinute is kept under the documented 20/min distinct-request
// ceiling to leave headroom for retries within the same window.
const maxRequestsPerMinute = 15

type Adapter struct {
	cfg    config.IngeconConfig
	client *http.Client
	limit  *rateLimiter
}

func New(cfg config.IngeconConfig) *Adapter {
	return &Adapter{
		cfg:    cfg,
		client: &http.Client{Timeout: 20 * time.Second},
		limit:  newRateLimiter(maxRequestsPerMinute, time.Minute),
	}
}

func (a *Adapter) Name() string { return string(models.BrandIngecon) }

func (a *Adapter) RateLimit() (int, time.Duration) { return maxRequestsPerMinute, time.Minute }

func (a *Adapter) ValidateCredentials(ctx context.Context) error {
	if a.cfg.APIKey == "" {
		return fmt.Errorf("ingecon: INGECON_API_KEY not configured")
	}
	_, err := a.listPlants(ctx)
	return err
}

// --- Plant list: GET api/users/plants ---

type plant struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Location         string `json:"location"`
	Timezone         string `json:"timezone"`
	Enabled          bool   `json:"enabled"`
	RegistrationDate string `json:"registrationDate"`
	PlantTypeID      string `json:"plantTypeId"` // "pv" or "sc"
	Boards           []string `json:"boards"`
}

func (a *Adapter) listPlants(ctx context.Context) ([]plant, error) {
	raw, err := a.get(ctx, "/api/users/plants")
	if err != nil {
		return nil, fmt.Errorf("plant list: %w", err)
	}
	var plants []plant
	if err := json.Unmarshal(raw, &plants); err != nil {
		return nil, fmt.Errorf("plant list: decode: %w", err)
	}
	return plants, nil
}

// Describe implements adapters.SiteDescriber from the same plant list call.
func (a *Adapter) Describe(ctx context.Context) ([]adapters.SiteDescriptor, error) {
	plants, err := a.listPlants(ctx)
	if err != nil {
		return nil, fmt.Errorf("ingecon: %w", err)
	}
	out := make([]adapters.SiteDescriptor, 0, len(plants))
	for _, p := range plants {
		out = append(out, adapters.SiteDescriptor{
			BrandSiteID: p.ID,
			Name:        p.Name,
			Location:    p.Location,
		})
	}
	return out, nil
}

// --- PV plant telemetry: GET api/ingecon/samplesv2/plant/{id}/date/{date} ---

type pvSample struct {
	SN        string    `json:"SN"`
	BoardID   string    `json:"BoardId"`
	DateTime  string    `json:"DateTime"`
	Pac       float64   `json:"Pac"`
	PacPv     float64   `json:"PacPv"`
	PacBatt   float64   `json:"PacBatt"`
	Qac       float64   `json:"Qac"`
	Alarms    string    `json:"alarms"`
	Warnings  string    `json:"warnings"`
	Vdc       []float64 `json:"Vdc"`
	Idc       []float64 `json:"Idc"`
	Pdc       []float64 `json:"Pdc"`
	EInjection float64  `json:"EInjection"`
	EAbsorption float64 `json:"EAbsorption"`
}

// --- Self-consumption plant telemetry: GET api/ems/samples/plant/{id}/date/{date} ---

type scSample struct {
	SOC                    float64 `json:"soc"`
	VBat                   float64 `json:"vBat"`
	Board                  string  `json:"board"`
	Phase                  int     `json:"phase"`
	DateTime               string  `json:"dateTime"`
	Consumption            float64 `json:"consumption"`
	FromGridToConsumption  float64 `json:"fromGridToConsumption"`
	PVGeneration           float64 `json:"pvGeneration"`
	FromStorageToConsumption float64 `json:"fromStorageToConsumption"`
	FromPVToConsumption    float64 `json:"fromPVToConsumption"`
	TotalConsumption       float64 `json:"totalConsumption"`
	SelfConsumptionRatio   float64 `json:"selfConsumptionRatio"`
}

// --- Presence: GET api/presence/plant/{id} ---

type presenceEntry struct {
	BoardID  string `json:"boardId"`
	DeviceID string `json:"deviceId"`
	Version  string `json:"version"`
	Node     int    `json:"node"`
	Presence struct {
		Connected bool  `json:"connected"`
		LastLog   int64 `json:"lastLog"`
	} `json:"presence"`
}

func (a *Adapter) fetchPresence(ctx context.Context, plantID string) ([]presenceEntry, error) {
	raw, err := a.get(ctx, "/api/presence/plant/"+plantID)
	if err != nil {
		return nil, err
	}
	var entries []presenceEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("presence: decode: %w", err)
	}
	return entries, nil
}

func anyConnected(entries []presenceEntry) bool {
	for _, e := range entries {
		if e.Presence.Connected {
			return true
		}
	}
	return false
}

// FetchAll lists every plant on the account and fetches today's telemetry
// for each, dispatching on plantTypeId, throttled to stay under Ingecon's
// documented rate limit.
func (a *Adapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	if a.cfg.APIKey == "" {
		return nil, fmt.Errorf("ingecon: not configured (INGECON_API_KEY empty) — use the mock adapter until credentials are set")
	}

	plants, err := a.listPlants(ctx)
	if err != nil {
		return nil, fmt.Errorf("ingecon: %w", err)
	}

	today := time.Now().Format("20060102")
	out := make([]models.SiteData, 0, len(plants))
	for _, p := range plants {
		if !p.Enabled {
			continue
		}

		var data models.SiteData
		var fetchErr error
		switch p.PlantTypeID {
		case "sc":
			data, fetchErr = a.fetchSCTelemetry(ctx, p.ID, today)
		default: // "pv" and anything unrecognized falls back to pv telemetry
			data, fetchErr = a.fetchPVTelemetry(ctx, p.ID, today)
		}

		if fetchErr != nil {
			out = append(out, models.SiteData{BrandSiteID: p.ID, Timestamp: time.Now(), Status: models.StatusOffline})
			continue
		}

		// The presence endpoint is the authoritative connectivity signal;
		// use it to override the data-derived status when a board is down.
		if presence, err := a.fetchPresence(ctx, p.ID); err == nil && len(presence) > 0 {
			if !anyConnected(presence) {
				data.Status = models.StatusOffline
			}
		}

		out = append(out, data)
	}
	return out, nil
}

func (a *Adapter) fetchPVTelemetry(ctx context.Context, plantID, date string) (models.SiteData, error) {
	raw, err := a.get(ctx, "/api/ingecon/samplesv2/plant/"+plantID+"/date/"+date)
	if err != nil {
		return models.SiteData{}, err
	}
	var samples []pvSample
	if err := json.Unmarshal(raw, &samples); err != nil {
		return models.SiteData{}, fmt.Errorf("pv telemetry: decode: %w", err)
	}
	if len(samples) == 0 {
		return models.SiteData{}, fmt.Errorf("pv telemetry: no samples for %s", date)
	}

	// Group by the latest DateTime (one row per inverter in that group)
	// and sum across inverters for a plant-level reading.
	latestTime := samples[0].DateTime
	for _, s := range samples {
		if s.DateTime > latestTime {
			latestTime = s.DateTime
		}
	}

	var pac, energyInjection float64
	var faultCode int
	ts := time.Now()
	if parsed, err := time.Parse("2006-01-02T15:04:05", latestTime); err == nil {
		ts = parsed
	}
	for _, s := range samples {
		if s.DateTime != latestTime {
			continue
		}
		pac += s.Pac
		energyInjection += s.EInjection
		if s.Alarms != "" && s.Alarms != "0000000000000000" {
			if bit, err := strconv.Atoi(s.Alarms); err == nil && bit != 0 {
				faultCode = bit
			} else if err != nil {
				faultCode = 1
			}
		}
	}

	status := models.StatusOnline
	if faultCode != 0 {
		status = models.StatusError
	}

	return models.SiteData{
		BrandSiteID: plantID,
		Timestamp:   ts,
		Power:       pac,
		EnergyToday: energyInjection,
		FaultCode:   &faultCode,
		Status:      status,
		Raw:         raw,
	}, nil
}

func (a *Adapter) fetchSCTelemetry(ctx context.Context, plantID, date string) (models.SiteData, error) {
	raw, err := a.get(ctx, "/api/ems/samples/plant/"+plantID+"/date/"+date)
	if err != nil {
		return models.SiteData{}, err
	}
	var samples []scSample
	if err := json.Unmarshal(raw, &samples); err != nil {
		return models.SiteData{}, fmt.Errorf("sc telemetry: decode: %w", err)
	}
	if len(samples) == 0 {
		return models.SiteData{}, fmt.Errorf("sc telemetry: no samples for %s", date)
	}

	last := samples[len(samples)-1]
	ts := time.Now()
	if parsed, err := time.Parse("2006-01-02T15:04:05", last.DateTime); err == nil {
		ts = parsed
	}

	soc := last.SOC
	batV := last.VBat
	grid := last.FromGridToConsumption
	load := last.TotalConsumption

	return models.SiteData{
		BrandSiteID: plantID,
		Timestamp:   ts,
		Power:       last.PVGeneration,
		SOC:         &soc,
		BatteryV:    &batV,
		GridPower:   &grid,
		LoadPower:   &load,
		Status:      models.StatusOnline,
		Raw:         raw,
	}, nil
}

// get performs a rate-limited GET against the Ingecon API with the required
// headers, transparently decoding a gzip response body.
func (a *Adapter) get(ctx context.Context, path string) ([]byte, error) {
	a.limit.wait(ctx)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-KEY", a.cfg.APIKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body := resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("gzip decode: %w", err)
		}
		defer gz.Close()
		body = gz
	}

	raw, err := io.ReadAll(body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("rate limited (429): %s", string(raw))
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("returned %d: %s", resp.StatusCode, string(raw))
	}
	return raw, nil
}

// rateLimiter is a minimal token bucket sufficient to keep this adapter
// under Ingecon's documented per-minute request ceiling without pulling in
// an external dependency.
type rateLimiter struct {
	mu       sync.Mutex
	max      int
	window   time.Duration
	count    int
	windowAt time.Time
}

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	return &rateLimiter{max: max, window: window, windowAt: time.Now()}
}

func (r *rateLimiter) wait(ctx context.Context) {
	for {
		r.mu.Lock()
		now := time.Now()
		if now.Sub(r.windowAt) >= r.window {
			r.windowAt = now
			r.count = 0
		}
		if r.count < r.max {
			r.count++
			r.mu.Unlock()
			return
		}
		sleepFor := r.window - now.Sub(r.windowAt)
		r.mu.Unlock()

		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepFor):
		}
	}
}
