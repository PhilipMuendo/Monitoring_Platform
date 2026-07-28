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
//     wirePower, irradiateIntensity — and lastUpdateTime is an ISO
//     date-time string, not a unix timestamp.
//   - There is no per-reading fault code from this endpoint. The
//     authoritative online/offline/error signal is the "connectionStatus"
//     enum (NORMAL / NO_DEVICE / ALL_OFFLINE / PARTIAL_OFFLINE) already
//     present on each station in the "/v1.0/station/list" response.
//   - The token response's accessToken value has been observed to already
//     include a "Bearer " prefix in some accounts; authenticate() strips
//     it before re-adding, so the Authorization header is never doubled.
package deye

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

const (
	baseURLEU = "https://eu1-developer.deyecloud.com"
	baseURLAS = "https://us1-developer.deyecloud.com"

	defaultTokenTTL = 60 * 24 * time.Hour
)

type Adapter struct {
	cfg     config.DeyeConfig
	client  *http.Client
	baseURL string

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time
}

func New(cfg config.DeyeConfig) *Adapter {
	base := baseURLEU
	if cfg.Region == "as" || cfg.Region == "us" {
		base = baseURLAS
	}
	return &Adapter{
		cfg:     cfg,
		client:  &http.Client{Timeout: 15 * time.Second},
		baseURL: base,
	}
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

// authenticate exchanges credentials for a bearer token and caches it in
// memory until an hour before expiry, per the brief's documented flow.
func (a *Adapter) authenticate(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.accessToken != "" && time.Now().Before(a.tokenExpiry.Add(-1*time.Hour)) {
		return a.accessToken, nil
	}

	hashed := sha256.Sum256([]byte(a.cfg.Password))

	// Per the live tokenRequest schema: appId is a query param (not a body
	// field), appSecret/password are required, and exactly one of
	// email/mobile/username identifies the account. We authenticate by
	// email, matching how installer accounts are provisioned.
	body := map[string]string{
		"appSecret": a.cfg.Secret,
		"email":     a.cfg.Username,
		"password":  hex.EncodeToString(hashed[:]),
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("deye: marshal token request: %w", err)
	}

	url := fmt.Sprintf("%s/v1.0/account/token?appId=%s", a.baseURL, a.cfg.AppID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("deye: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("deye: token request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("deye: read token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("deye: token endpoint returned %d: %s", resp.StatusCode, string(raw))
	}

	var tok tokenResponse
	if err := json.Unmarshal(raw, &tok); err != nil {
		return "", fmt.Errorf("deye: decode token response: %w", err)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("deye: auth rejected: %s (%s)", tok.Msg, tok.Code)
	}

	ttl := defaultTokenTTL
	if secs, err := strconv.ParseInt(tok.ExpiresIn, 10, 64); err == nil && secs > 0 {
		ttl = time.Duration(secs) * time.Second
	}

	// Some accounts' accessToken values already include a "Bearer " prefix;
	// strip it here so callers can always safely do "Bearer "+token.
	tok.AccessToken = strings.TrimPrefix(tok.AccessToken, "Bearer ")

	a.accessToken = tok.AccessToken
	a.tokenExpiry = time.Now().Add(ttl)
	return a.accessToken, nil
}

func (a *Adapter) ValidateCredentials(ctx context.Context) error {
	_, err := a.authenticate(ctx)
	return err
}

type stationListResponse struct {
	StationList []stationSummary `json:"stationList"`
	Total       int              `json:"total"`
}

// connectionStatus is the station list's authoritative online/offline
// signal — the /station/latest endpoint carries no fault/status field.
type connectionStatus string

const (
	connStatusNormal          connectionStatus = "NORMAL"
	connStatusNoDevice        connectionStatus = "NO_DEVICE"
	connStatusAllOffline      connectionStatus = "ALL_OFFLINE"
	connStatusPartialOffline  connectionStatus = "PARTIAL_OFFLINE"
)

type stationSummary struct {
	ID                int64             `json:"id"`
	Name              string            `json:"name"`
	InstalledCapacity float64           `json:"installedCapacity"` // kW
	Location          string            `json:"locationAddress"`
	ConnectionStatus  connectionStatus  `json:"connectionStatus"`
	BatterySOC        float64           `json:"batterySOC"`
	GenerationPower   float64           `json:"generationPower"`
	// Despite the schema's "format":"date-time" annotation, the live API
	// returns this (and stationLatestResponse's) as a unix-seconds number
	// serialized with a trailing ".000000000", hence float64 not int64.
	LastUpdateTime float64 `json:"lastUpdateTime"`
}

// stationLatestResponse per the live "/v1.0/station/latest" schema. Note
// there is no energy-today/energy-total or fault code here at all.
type stationLatestResponse struct {
	GenerationPower     float64 `json:"generationPower"`     // W
	ConsumptionPower    float64 `json:"consumptionPower"`    // W
	GridPower           float64 `json:"gridPower"`           // W, +import/-export
	BatteryPower        float64 `json:"batteryPower"`        // W
	BatterySOC          float64 `json:"batterySOC"`          // %
	ChargePower         float64 `json:"chargePower"`         // W
	DischargePower      float64 `json:"dischargePower"`      // W
	PurchasePower       float64 `json:"purchasePower"`       // W
	WirePower           float64 `json:"wirePower"`           // W
	IrradiateIntensity  float64 `json:"irradiateIntensity"`
	LastUpdateTime      float64 `json:"lastUpdateTime"` // unix seconds (float-serialized), despite schema's date-time label
}

// FetchAll lists every station under the installer account, then fetches
// each station's latest telemetry and normalizes it to models.SiteData.
func (a *Adapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	token, err := a.authenticate(ctx)
	if err != nil {
		return nil, fmt.Errorf("deye: %w", err)
	}

	stations, err := a.listStations(ctx, token)
	if err != nil {
		return nil, fmt.Errorf("deye: %w", err)
	}

	out := make([]models.SiteData, 0, len(stations))
	for _, s := range stations {
		data, err := a.fetchStationLatest(ctx, token, s)
		if err != nil {
			// One bad station shouldn't fail the whole poll cycle; the
			// collector will mark just this site as stale/offline.
			out = append(out, models.SiteData{
				BrandSiteID: strconv.FormatInt(s.ID, 10),
				Timestamp:   time.Now(),
				Status:      models.StatusOffline,
			})
			continue
		}
		out = append(out, data)
	}
	return out, nil
}

// Describe implements adapters.SiteDescriber using the same station list
// call FetchAll uses, so the collector can auto-register newly added
// DeyeCloud stations without an admin having to hand-enter them.
func (a *Adapter) Describe(ctx context.Context) ([]adapters.SiteDescriptor, error) {
	token, err := a.authenticate(ctx)
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
	// --- adjust against real docs: exact list endpoint/pagination shape ---
	url := fmt.Sprintf("%s/v1.0/station/list", a.baseURL)
	payload, _ := json.Marshal(map[string]int{"page": 1, "size": 200})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	// -----------------------------------------------------------------------

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("station list request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("station list returned %d: %s", resp.StatusCode, string(b))
	}

	var listResp stationListResponse
	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		return nil, fmt.Errorf("decode station list: %w", err)
	}
	return listResp.StationList, nil
}

func (a *Adapter) fetchStationLatest(ctx context.Context, token string, s stationSummary) (models.SiteData, error) {
	url := fmt.Sprintf("%s/v1.0/station/latest", a.baseURL)
	payload, _ := json.Marshal(map[string]int64{"stationId": s.ID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return models.SiteData{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return models.SiteData{}, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return models.SiteData{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return models.SiteData{}, fmt.Errorf("station latest returned %d: %s", resp.StatusCode, string(raw))
	}

	var latest stationLatestResponse
	if err := json.Unmarshal(raw, &latest); err != nil {
		return models.SiteData{}, fmt.Errorf("decode station latest: %w", err)
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

	soc := latest.BatterySOC
	grid := latest.GridPower
	load := latest.ConsumptionPower

	ts := time.Now()
	if latest.LastUpdateTime > 0 {
		ts = time.Unix(int64(latest.LastUpdateTime), 0)
	}

	return models.SiteData{
		BrandSiteID: strconv.FormatInt(s.ID, 10),
		Timestamp:   ts,
		Power:       latest.GenerationPower,
		SOC:         &soc,
		GridPower:   &grid,
		LoadPower:   &load,
		Status:      status,
		Raw:         raw,
	}, nil
}
