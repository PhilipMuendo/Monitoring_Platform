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
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/adapters/httpjson"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

// maxRequestsPerMinute is kept under the documented 20/min distinct-request
// ceiling to leave headroom for retries within the same window.
const maxRequestsPerMinute = 15

type Adapter struct {
	cfg    config.IngeconConfig
	client *httpjson.Client
	limit  *rateLimiter
}

func New(cfg config.IngeconConfig, hooks httpjson.Hooks) *Adapter {
	return &Adapter{
		cfg:    cfg,
		client: httpjson.New(string(models.BrandIngecon), httpjson.Defaults(), hooks),
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
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Location         string   `json:"location"`
	Timezone         string   `json:"timezone"`
	Enabled          bool     `json:"enabled"`
	RegistrationDate string   `json:"registrationDate"`
	PlantTypeID      string   `json:"plantTypeId"` // "pv" or "sc"
	Boards           []string `json:"boards"`

	// The plant list already carries the same connectivity flag the
	// /api/presence/plant/{id} endpoint returns, verified live against all
	// four plants on the account. Reading it here removes one HTTP call per
	// plant per cycle, which matters against a 15 req/min ceiling.
	//
	// Note there is deliberately no capacity field: the Ingecon plant record
	// simply does not expose installed kWp, so capacity has to be entered
	// through the admin UI and Describe must not overwrite it with a zero.
	Presence struct {
		Connected bool  `json:"connected"`
		LastLog   int64 `json:"lastLog"`
	} `json:"presence"`
}

// sampleLayout is the shape of every DateTime/dateTime field the sample
// endpoints return: a wall-clock stamp with no zone or offset.
const sampleLayout = "2006-01-02T15:04:05"

// parseSampleTime interprets a sample's wall-clock stamp in the plant's own
// timezone.
//
// This is not cosmetic. The stamps are plant-local — verified live against
// GWS Kitale Dairy, whose last sample read 2026-07-29T11:15:00 while
// Nairobi wall-clock was 11:17 and UTC was 08:17. Parsing them with
// time.Parse yields UTC, which for an EAT plant puts every reading three
// hours in the *future*, and that breaks three things at once:
//
//   - time.Since(reading.Timestamp) goes negative, so the alert engine's
//     staleness check can never fire and a dead Ingecon board is only ever
//     caught by the presence flag;
//   - last_seen_at is in the future, so the UI cheerfully reports "last
//     seen 1m ago" for a plant that has been silent for hours;
//   - metrics land in the future, leaving a three-hour hole at the right
//     edge of every history chart.
//
// Falls back to UTC if the zone database has no entry for the plant's
// timezone, which is still better than silently mislabelling the instant.
func parseSampleTime(value, timezone string) (time.Time, bool) {
	if value == "" {
		return time.Time{}, false
	}
	loc := time.UTC
	if timezone != "" {
		if l, err := time.LoadLocation(timezone); err == nil {
			loc = l
		}
	}
	parsed, err := time.ParseInLocation(sampleLayout, value, loc)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

// integrateEnergyKWh trapezoid-integrates a power series (watts, against
// wall-clock sample stamps) into kWh.
//
// Ingecon exposes no energy-today register on the self-consumption
// endpoint, but it does return the whole day's samples on the call we
// already make — so the day's yield is recoverable from measured data at
// zero extra API cost. Gaps longer than an hour are skipped rather than
// bridged, so an offline stretch doesn't get back-filled with an
// interpolated ramp that never happened.
func integrateEnergyKWh(times []time.Time, watts []float64) float64 {
	const maxGap = time.Hour

	var wh float64
	for i := 1; i < len(times) && i < len(watts); i++ {
		dt := times[i].Sub(times[i-1])
		if dt <= 0 || dt > maxGap {
			continue
		}
		wh += (watts[i] + watts[i-1]) / 2 * dt.Hours()
	}
	return wh / 1000
}

func (a *Adapter) listPlants(ctx context.Context) ([]plant, error) {
	raw, err := a.get(ctx, "/api/users/plants", "/api/users/plants")
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
	SN          string    `json:"SN"`
	BoardID     string    `json:"BoardId"`
	DateTime    string    `json:"DateTime"`
	Pac         float64   `json:"Pac"`
	PacPv       float64   `json:"PacPv"`
	PacBatt     float64   `json:"PacBatt"`
	Qac         float64   `json:"Qac"`
	Alarms      string    `json:"alarms"`
	Warnings    string    `json:"warnings"`
	Vdc         []float64 `json:"Vdc"`
	Idc         []float64 `json:"Idc"`
	Pdc         []float64 `json:"Pdc"`
	EInjection  float64   `json:"EInjection"`
	EAbsorption float64   `json:"EAbsorption"`
}

// --- Self-consumption plant telemetry: GET api/ems/samples/plant/{id}/date/{date} ---

type scSample struct {
	SOC                      float64 `json:"soc"`
	VBat                     float64 `json:"vBat"`
	Board                    string  `json:"board"`
	Phase                    int     `json:"phase"`
	DateTime                 string  `json:"dateTime"`
	Consumption              float64 `json:"consumption"`
	FromGridToConsumption    float64 `json:"fromGridToConsumption"`
	PVGeneration             float64 `json:"pvGeneration"`
	FromStorageToConsumption float64 `json:"fromStorageToConsumption"`
	FromPVToConsumption      float64 `json:"fromPVToConsumption"`
	TotalConsumption         float64 `json:"totalConsumption"`
	SelfConsumptionRatio     float64 `json:"selfConsumptionRatio"`
}

// The dedicated presence endpoint (GET api/presence/plant/{id}) is no
// longer called. The plant list returned by api/users/plants carries the
// identical connected flag for every plant — verified live against all four
// plants on this account — so reading it there costs one request per cycle
// instead of one per plant, which matters against a 15 req/min ceiling.

// FetchAll lists every plant on the account and fetches today's telemetry
// for each, dispatching on plantTypeId, throttled to stay under Ingecon's
// documented rate limit.
func (a *Adapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	if a.cfg.APIKey == "" {
		return nil, fmt.Errorf("ingecon: not configured (INGECON_API_KEY empty)")
	}

	plants, err := a.listPlants(ctx)
	if err != nil {
		return nil, fmt.Errorf("ingecon: %w", err)
	}

	out := make([]models.SiteData, 0, len(plants))
	for _, p := range plants {
		if !p.Enabled {
			continue
		}

		// The sample endpoints are keyed by the plant's own calendar date.
		// Using the server's date would ask an EAT plant for "yesterday"
		// through the whole 21:00-00:00 UTC window.
		today := plantToday(p.Timezone)

		var data models.SiteData
		var fetchErr error
		switch p.PlantTypeID {
		case "sc":
			data, fetchErr = a.fetchSCTelemetry(ctx, p.ID, today, p.Timezone)
		default: // "pv" and anything unrecognized falls back to pv telemetry
			data, fetchErr = a.fetchPVTelemetry(ctx, p.ID, today, p.Timezone)
		}

		if fetchErr != nil {
			// Unknown, not Offline. A sample-endpoint failure tells us
			// nothing about the plant — only that we could not read it —
			// and the alert engine treats Offline as a wake-someone event.
			slog.Warn("ingecon: telemetry unavailable", "plant", p.ID, "error", fetchErr)
			out = append(out, models.SiteData{BrandSiteID: p.ID, Timestamp: time.Now(), Status: models.StatusUnknown})
			continue
		}

		// Connectivity is authoritative over anything derived from the
		// samples. When the board is down, the last sample's power is a
		// historical value, not a live one — reporting it beside an
		// "Offline" badge produced the contradiction of a plant shown as
		// both offline and generating 1.6 kW. Zero the instantaneous
		// channels and keep the timestamp, so the UI's "last seen" is the
		// honest signal. Energy today stays: it is a day total, not a
		// snapshot, and remains true for the hours the plant did run.
		if !p.Presence.Connected {
			data.Status = models.StatusOffline
			data.Power = nil
			data.GridPower = nil
			data.LoadPower = nil
			data.SOC = nil
			data.BatteryV = nil
		}

		out = append(out, data)
	}
	return out, nil
}

// plantToday returns today's date in the plant's timezone, formatted the
// way the sample endpoints expect.
func plantToday(timezone string) string {
	now := time.Now()
	if timezone != "" {
		if loc, err := time.LoadLocation(timezone); err == nil {
			now = now.In(loc)
		}
	}
	return now.Format("20060102")
}

func (a *Adapter) fetchPVTelemetry(ctx context.Context, plantID, date, timezone string) (models.SiteData, error) {
	raw, err := a.get(ctx, "/api/ingecon/samplesv2/plant/{id}/date/{date}", "/api/ingecon/samplesv2/plant/"+plantID+"/date/"+date)
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
	if parsed, ok := parseSampleTime(latestTime, timezone); ok {
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
		Power:       &pac,
		EnergyToday: &energyInjection,
		FaultCode:   &faultCode,
		Status:      status,
		Raw:         raw,
	}, nil
}

func (a *Adapter) fetchSCTelemetry(ctx context.Context, plantID, date, timezone string) (models.SiteData, error) {
	raw, err := a.get(ctx, "/api/ems/samples/plant/{id}/date/{date}", "/api/ems/samples/plant/"+plantID+"/date/"+date)
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

	// Integrate the whole day's PV series for today's yield — this endpoint
	// has no energy register of its own, and these samples are already in
	// hand.
	times := make([]time.Time, 0, len(samples))
	watts := make([]float64, 0, len(samples))
	for _, s := range samples {
		ts, ok := parseSampleTime(s.DateTime, timezone)
		if !ok {
			continue
		}
		times = append(times, ts)
		watts = append(watts, s.PVGeneration)
	}

	last := samples[len(samples)-1]
	ts := time.Now()
	if parsed, ok := parseSampleTime(last.DateTime, timezone); ok {
		ts = parsed
	}

	soc := last.SOC
	batV := last.VBat
	grid := last.FromGridToConsumption
	load := last.TotalConsumption

	pv := last.PVGeneration
	energy := integrateEnergyKWh(times, watts)

	return models.SiteData{
		BrandSiteID: plantID,
		Timestamp:   ts,
		Power:       &pv,
		EnergyToday: &energy,
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
// get performs a rate-limited GET against the Ingecon API.
//
// The retry, backoff, 429 Retry-After handling and gzip decoding all live
// in httpjson now. The local token bucket stays: it is *proactive*
// throttling to keep us under Ingecon's documented 20 req/min ceiling in
// the first place, which is a different job from reacting to a 429 after
// the fact. Both matter — the bucket avoids the limit, the retry survives
// it when a burst slips through anyway.
func (a *Adapter) get(ctx context.Context, endpoint, path string) ([]byte, error) {
	if err := a.limit.wait(ctx); err != nil {
		return nil, err
	}
	return a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodGet,
		URL:      a.cfg.BaseURL + path,
		Endpoint: endpoint,
		Header: http.Header{
			"X-API-KEY": []string{a.cfg.APIKey},
			// Ingecon rejects requests that don't advertise gzip; sending it
			// ourselves disables Go's automatic decompression, so httpjson
			// gunzips manually.
			"Accept-Encoding": []string{"gzip"},
		},
	}, nil)
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

// wait blocks until a token is available, or returns ctx.Err().
//
// It used to return nothing and swallow cancellation, so a shutdown or a
// cycle timeout during a throttle wait was indistinguishable from having
// acquired a token — the caller went straight on to issue the request it
// was supposed to have abandoned.
func (r *rateLimiter) wait(ctx context.Context) error {
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
			return nil
		}
		sleepFor := r.window - now.Sub(r.windowAt)
		r.mu.Unlock()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleepFor):
		}
	}
}
