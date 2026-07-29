// Package deye implements models.BrandAdapter against the DeyeCloud open
// platform API. Endpoint paths and every request/response field below were
// pulled directly from the live OpenAPI (Swagger 2.0) document served at
// https://eu1-developer.deyecloud.com/v2/api-docs — not guessed.
//
// Notable corrections from an earlier best-guess version of this file:
//   - The API host is "eu1-developer.deyecloud.com", not a separate
//     "eu1-openapi.deyecloud.com" (that host doesn't resolve at all).
//   - "/v1.0/station/latest" does NOT return today/total energy or a fault
//     code. Its real fields are generationPower, consumptionPower,
//     gridPower, batteryPower/SOC, charge/dischargePower, purchasePower,
//     wirePower, irradiateIntensity — and lastUpdateTime is a unix-seconds
//     number, not the ISO date-time string the schema claims.
//   - There is no per-reading fault code from this endpoint. The
//     authoritative online/offline/error signal is the "connectionStatus"
//     enum (NORMAL / NO_DEVICE / ALL_OFFLINE / PARTIAL_OFFLINE) already
//     present on each station in the "/v1.0/station/list" response.
//   - The token response's accessToken value has been observed to already
//     include a "Bearer " prefix in some accounts; the token fetch strips
//     it before re-adding, so the Authorization header is never doubled.
//   - Several numeric fields are returned as JSON null on plants that lack
//     the corresponding hardware (gridPower and purchasePower on an
//     off-grid site, for instance). They are modelled as *float64 so a
//     missing channel stays missing instead of becoming a confident 0 W.
package deye

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/adapters/httpjson"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

const (
	baseURLEU = "https://eu1-developer.deyecloud.com"
	baseURLAS = "https://us1-developer.deyecloud.com"

	defaultTokenTTL = 60 * 24 * time.Hour
	// Refresh a day ahead of expiry. The tokens last ~60 days, so this is
	// free insurance against a long-running process holding one right up to
	// the boundary.
	tokenRefreshLead = 24 * time.Hour
)

type Adapter struct {
	cfg     config.DeyeConfig
	client  *httpjson.Client
	baseURL string
	tokens  *httpjson.TokenCache
}

func New(cfg config.DeyeConfig, hooks httpjson.Hooks) *Adapter {
	base := baseURLEU
	if cfg.Region == "as" || cfg.Region == "us" {
		base = baseURLAS
	}
	a := &Adapter{
		cfg:     cfg,
		client:  httpjson.New(string(models.BrandDeye), httpjson.Defaults(), hooks),
		baseURL: base,
	}
	a.tokens = httpjson.NewTokenCache(tokenRefreshLead, a.fetchToken)
	return a
}

func (a *Adapter) Name() string { return string(models.BrandDeye) }

// RateLimit is a conservative default until confirmed against the
// installer account's actual DeyeCloud plan/tier.
func (a *Adapter) RateLimit() (int, time.Duration) { return 60, time.Minute }

type tokenResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	// ExpiresIn is documented as a string in the live schema (e.g. "5183999"
	// seconds), not a number, despite representing a duration.
	ExpiresIn string `json:"expiresIn"`
	Code      string `json:"code"`
	Msg       string `json:"msg"`
}

// fetchToken exchanges credentials for a bearer token. Caching, expiry and
// single-flight refresh are handled by httpjson.TokenCache.
func (a *Adapter) fetchToken(ctx context.Context) (string, time.Duration, error) {
	hashed := sha256.Sum256([]byte(a.cfg.Password))

	// Per the live tokenRequest schema: appId is a query param (not a body
	// field), appSecret/password are required, and exactly one of
	// email/mobile/username identifies the account. We authenticate by
	// email, matching how installer accounts are provisioned.
	var tok tokenResponse
	_, err := a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodPost,
		URL:      fmt.Sprintf("%s/v1.0/account/token?appId=%s", a.baseURL, a.cfg.AppID),
		Endpoint: "/v1.0/account/token",
		Body: map[string]string{
			"appSecret": a.cfg.Secret,
			"email":     a.cfg.Username,
			"password":  hex.EncodeToString(hashed[:]),
		},
	}, &tok)
	if err != nil {
		return "", 0, fmt.Errorf("deye: token request: %w", err)
	}
	if tok.AccessToken == "" {
		return "", 0, fmt.Errorf("deye: auth rejected: %s (%s)", tok.Msg, tok.Code)
	}

	ttl := defaultTokenTTL
	if secs, err := strconv.ParseInt(tok.ExpiresIn, 10, 64); err == nil && secs > 0 {
		ttl = time.Duration(secs) * time.Second
	}

	// Some accounts' accessToken values already include a "Bearer " prefix;
	// strip it here so callers can always safely do "Bearer "+token.
	return strings.TrimPrefix(tok.AccessToken, "Bearer "), ttl, nil
}

func (a *Adapter) ValidateCredentials(ctx context.Context) error {
	_, err := a.tokens.Get(ctx)
	return err
}

func (a *Adapter) authHeader(token string) http.Header {
	return http.Header{"Authorization": []string{"Bearer " + token}}
}

type stationListResponse struct {
	StationList []stationSummary `json:"stationList"`
	Total       int              `json:"total"`
}

// connectionStatus is the station list's authoritative online/offline
// signal — the /station/latest endpoint carries no fault/status field.
type connectionStatus string

const (
	connStatusNormal         connectionStatus = "NORMAL"
	connStatusNoDevice       connectionStatus = "NO_DEVICE"
	connStatusAllOffline     connectionStatus = "ALL_OFFLINE"
	connStatusPartialOffline connectionStatus = "PARTIAL_OFFLINE"
)

type stationSummary struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	InstalledCapacity float64 `json:"installedCapacity"` // kW
	Location          string  `json:"locationAddress"`
	// IANA zone for the station, e.g. "Africa/Nairobi". Needed to ask
	// /station/history for the right calendar day: the server's date is a
	// day behind the plant's for part of every evening.
	RegionTimezone   string           `json:"regionTimezone"`
	ConnectionStatus connectionStatus `json:"connectionStatus"`
	BatterySOC       *float64         `json:"batterySOC"`
	GenerationPower  *float64         `json:"generationPower"`
	// Despite the schema's "format":"date-time" annotation, the live API
	// returns this (and stationLatestResponse's) as a unix-seconds number
	// serialized with a trailing ".000000000", hence float64 not int64.
	LastUpdateTime float64 `json:"lastUpdateTime"`
}

// stationLatestResponse per the live "/v1.0/station/latest" schema. Note
// there is no energy-today/energy-total or fault code here at all, and
// every power channel can come back null.
type stationLatestResponse struct {
	GenerationPower    *float64 `json:"generationPower"`  // W
	ConsumptionPower   *float64 `json:"consumptionPower"` // W
	GridPower          *float64 `json:"gridPower"`        // W, +import/-export
	BatteryPower       *float64 `json:"batteryPower"`     // W
	BatterySOC         *float64 `json:"batterySOC"`       // %
	ChargePower        *float64 `json:"chargePower"`      // W
	DischargePower     *float64 `json:"dischargePower"`   // W
	PurchasePower      *float64 `json:"purchasePower"`    // W
	WirePower          *float64 `json:"wirePower"`        // W
	IrradiateIntensity *float64 `json:"irradiateIntensity"`
	LastUpdateTime     float64  `json:"lastUpdateTime"` // unix seconds (float-serialized)
}

// FetchAll lists every station under the installer account, then fetches
// each station's latest telemetry and normalizes it to models.SiteData.
//
// Failure handling is deliberately graded. A failure to list stations is
// returned as an error, because we genuinely don't know what exists. A
// failure on one station's detail call degrades *that site* to
// StatusUnknown and leaves the rest of the fleet untouched — it must never
// be reported as StatusOffline, which the alert engine treats as a real
// outage worth waking someone for.
func (a *Adapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	token, err := a.tokens.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("deye: %w", err)
	}

	stations, err := a.listStations(ctx, token)
	if err != nil {
		return nil, fmt.Errorf("deye: %w", err)
	}

	out := make([]models.SiteData, 0, len(stations))
	for _, s := range stations {
		id := strconv.FormatInt(s.ID, 10)

		data, err := a.fetchStationLatest(ctx, token, s)
		if err != nil {
			if httpjson.Unauthorized(err) {
				// The vendor revoked the token mid-cycle; drop it so the
				// next cycle re-authenticates instead of replaying it.
				a.tokens.Invalidate()
			}
			slog.Warn("deye: station telemetry unavailable", "station", s.ID, "error", err)
			out = append(out, models.SiteData{
				BrandSiteID: id,
				Timestamp:   time.Now(),
				Status:      models.StatusUnknown,
			})
			continue
		}

		// Energy today needs a second call per station because it isn't in
		// /station/latest. A failure here is not fatal: the site still has
		// valid live telemetry, so log-and-continue with EnergyToday left
		// nil (rendered as an em dash) rather than dropping the reading or
		// asserting a false zero.
		if kwh, err := a.fetchStationDayEnergy(ctx, token, s); err == nil {
			data.EnergyToday = &kwh
		} else {
			slog.Warn("deye: energy-today unavailable", "station", s.ID, "error", err)
		}

		out = append(out, data)
	}
	return out, nil
}

// Describe implements adapters.SiteDescriber using the same station list
// call FetchAll uses, so the collector can auto-register newly added
// DeyeCloud stations without an admin having to hand-enter them.
func (a *Adapter) Describe(ctx context.Context) ([]adapters.SiteDescriptor, error) {
	token, err := a.tokens.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("deye: %w", err)
	}
	stations, err := a.listStations(ctx, token)
	if err != nil {
		return nil, fmt.Errorf("deye: %w", err)
	}
	out := make([]adapters.SiteDescriptor, 0, len(stations))
	for _, s := range stations {
		out = append(out, adapters.SiteDescriptor{
			BrandSiteID: strconv.FormatInt(s.ID, 10),
			Name:        s.Name,
			CapacityKW:  s.InstalledCapacity,
			Location:    s.Location,
		})
	}
	return out, nil
}

func (a *Adapter) listStations(ctx context.Context, token string) ([]stationSummary, error) {
	var listResp stationListResponse
	_, err := a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodPost,
		URL:      a.baseURL + "/v1.0/station/list",
		Endpoint: "/v1.0/station/list",
		Header:   a.authHeader(token),
		Body:     map[string]int{"page": 1, "size": 200},
	}, &listResp)
	if err != nil {
		return nil, fmt.Errorf("station list: %w", err)
	}
	return listResp.StationList, nil
}

// stationHistoryResponse is the "/v1.0/station/history" payload. With
// granularity 1 it returns the current day's intra-day series (~136 points
// for a 24h day), each carrying instantaneous power against a unix
// timestamp. `generationValue` — the kWh register — is null at this
// granularity; it is only populated at granularity 2, which returns
// *completed* days only and therefore never includes today.
type stationHistoryResponse struct {
	Items []struct {
		GenerationPower float64 `json:"generationPower"` // W
		TimeStamp       float64 `json:"timeStamp"`       // unix seconds
	} `json:"stationDataItems"`
}

// fetchStationDayEnergy returns today's generated kWh for a station.
//
// Deye's "/v1.0/station/latest" carries no energy-today field at all (see
// the package header), which left every Deye site reporting 0.0 kWh and the
// fleet-wide "Energy today" tile permanently reading zero once the mock
// adapter was removed — 8 of the 12 sites on this account are Deye. Since
// no register is exposed for the running day, the day's yield is recovered
// by integrating the inverter's own measured power series. That is
// preferable to integrating our stored site_metrics, because the brand's
// series covers the whole day including hours before this collector was
// running, and matches what the customer sees in the Deye app.
func (a *Adapter) fetchStationDayEnergy(ctx context.Context, token string, s stationSummary) (float64, error) {
	loc := time.UTC
	if s.RegionTimezone != "" {
		if l, err := time.LoadLocation(s.RegionTimezone); err == nil {
			loc = l
		}
	}
	day := time.Now().In(loc).Format("2006-01-02")

	var hist stationHistoryResponse
	_, err := a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodPost,
		URL:      a.baseURL + "/v1.0/station/history",
		Endpoint: "/v1.0/station/history",
		Header:   a.authHeader(token),
		Body: map[string]any{
			"stationId":   s.ID,
			"startAt":     day,
			"endAt":       day,
			"granularity": 1,
		},
	}, &hist)
	if err != nil {
		return 0, fmt.Errorf("station history: %w", err)
	}

	// Trapezoid rule over the series. Gaps longer than an hour are skipped
	// rather than bridged, so a comms outage isn't back-filled with an
	// interpolated ramp that never happened.
	const maxGap = time.Hour
	var wh float64
	for i := 1; i < len(hist.Items); i++ {
		prev, cur := hist.Items[i-1], hist.Items[i]
		if prev.TimeStamp <= 0 || cur.TimeStamp <= 0 {
			continue
		}
		dt := time.Unix(int64(cur.TimeStamp), 0).Sub(time.Unix(int64(prev.TimeStamp), 0))
		if dt <= 0 || dt > maxGap {
			continue
		}
		wh += (cur.GenerationPower + prev.GenerationPower) / 2 * dt.Hours()
	}
	return wh / 1000, nil
}

func (a *Adapter) fetchStationLatest(ctx context.Context, token string, s stationSummary) (models.SiteData, error) {
	var latest stationLatestResponse
	raw, err := a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodPost,
		URL:      a.baseURL + "/v1.0/station/latest",
		Endpoint: "/v1.0/station/latest",
		Header:   a.authHeader(token),
		Body:     map[string]int64{"stationId": s.ID},
	}, &latest)
	if err != nil {
		return models.SiteData{}, fmt.Errorf("station latest: %w", err)
	}

	// The station list's connectionStatus is the only real online/offline
	// signal DeyeCloud exposes; /station/latest has no fault field.
	status := models.StatusOnline
	switch s.ConnectionStatus {
	case connStatusAllOffline, connStatusNoDevice:
		status = models.StatusOffline
	case connStatusPartialOffline:
		status = models.StatusWarning
	}

	ts := time.Now()
	if latest.LastUpdateTime > 0 {
		ts = time.Unix(int64(latest.LastUpdateTime), 0)
	}

	return models.SiteData{
		BrandSiteID: strconv.FormatInt(s.ID, 10),
		Timestamp:   ts,
		Power:       latest.GenerationPower,
		SOC:         latest.BatterySOC,
		GridPower:   latest.GridPower,
		LoadPower:   latest.ConsumptionPower,
		Status:      status,
		Raw:         raw,
	}, nil
}
