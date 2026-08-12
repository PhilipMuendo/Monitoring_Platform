// Package sosen implements models.BrandAdapter for Sosen ("Inteless")
// inverters. Contrary to the project brief's assumption that Sosen has no
// public API and would need a browser-automation scraper, live inspection
// of the sosen.inteless.com portal (with the account's own credentials)

// found that the portal's dashboard itself is a thin client over a real
// JSON REST API at https://pv.inteless.com — the same kind of API every
// other brand adapter talks to. No scraping is needed at all.
//
// Endpoints and auth confirmed live against the real account:
//   - POST https://pv.inteless.com/oauth/token
//     Body (as JSON, NOT form-encoded, with Content-Type: application/json):
//     {"grant_type":"password","username":"...","password":"..."}
//     Response: {"code":0,"msg":"Success","success":true,
//     "data":{"access_token","refresh_token","scope","token_type":"Bearer","expires_in"}}
//     expires_in was observed as 7775999 seconds (~90 days), same order as
//     Deye's token lifetime.
//   - GET /api/v1/plants?page=&limit=&status=&type=&sortCol=&order=&countryCode=
//     -> {"data":{"total","infos":[{"id","name","status","pac","efficiency",
//     "etoday","etotal","address","updateAt","type"}]}} — status 1 == online,
//     0 == offline, observed directly against 8 real plants.
//   - GET /api/v1/plant/{id}/realtime?id={id}
//     -> {"data":{"pac","etoday","emonth","eyear","etotal","gridPower",
//     "batPower","storagePower","totalPower" (capacity kW),"efficiency"}}
//   - GET /api/v1/plant/{id}/deviceCount?invType=
//     -> {"data":{"warning","fault","total","normal","offline"}} — the
//     authoritative per-plant device health signal.
//   - GET /api/v1/plant/{id}/inverters?page=&limit=&status=&sn=&stationId={id}&type=
//     -> per-plant inverter list (used to get an SN for battery lookup).
//   - GET /api/v1/inverter/battery/{sn}/realtime?sn=&lan=en -> per-inverter
//     battery SOC. Note: /api/v1/batt/plant/{id}/flag's "battStationFlag"
//     looks like a "does this plant have a battery" signal but was observed
//     live to be false on a plant whose dashboard showed an active battery
//     at 54% SOC, so it is NOT used to gate this call — we just always try
//     it and ignore failures/zero results.
package sosen

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/adapters/httpjson"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
)

const (
	apiBaseURL      = "https://pv.inteless.com"
	defaultTokenTTL = 60 * 24 * time.Hour
)

type Adapter struct {
	cfg     config.SosenConfig
	client  *httpjson.Client
	baseURL string
	tokens  *httpjson.TokenCache
}

func New(cfg config.SosenConfig, hooks httpjson.Hooks) *Adapter {
	a := &Adapter{
		cfg:     cfg,
		client:  httpjson.New(string(models.BrandSosen), httpjson.Defaults(), hooks),
		baseURL: apiBaseURL,
	}
	a.tokens = httpjson.NewTokenCache(time.Hour, a.fetchToken)
	return a
}

func (a *Adapter) Name() string { return string(models.BrandSosen) }

func (a *Adapter) RateLimit() (int, time.Duration) { return 60, time.Minute }

type tokenResponse struct {
	Code    int    `json:"code"`
	Msg     string `json:"msg"`
	Success bool   `json:"success"`
	Data    struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
	} `json:"data"`
}

// fetchToken authenticates against the portal's OAuth endpoint. Note the
// body is JSON, not form-encoded — confirmed live; form encoding is
// rejected. Caching, expiry and single-flight refresh live in
// httpjson.TokenCache.
func (a *Adapter) fetchToken(ctx context.Context) (string, time.Duration, error) {
	var tok tokenResponse
	_, err := a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodPost,
		URL:      a.baseURL + "/oauth/token",
		Endpoint: "/oauth/token",
		Body: map[string]string{
			"grant_type": "password",
			"username":   a.cfg.Username,
			"password":   a.cfg.Password,
		},
	}, &tok)
	if err != nil {
		return "", 0, fmt.Errorf("sosen: token request: %w", err)
	}
	if !tok.Success || tok.Data.AccessToken == "" {
		return "", 0, fmt.Errorf("sosen: auth rejected: %s", tok.Msg)
	}

	ttl := defaultTokenTTL
	if tok.Data.ExpiresIn > 0 {
		ttl = time.Duration(tok.Data.ExpiresIn) * time.Second
	}
	return tok.Data.AccessToken, ttl, nil
}

func (a *Adapter) ValidateCredentials(ctx context.Context) error {
	_, err := a.tokens.Get(ctx)
	return err
}

type apiEnvelope struct {
	Code    int             `json:"code"`
	Msg     string          `json:"msg"`
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
}

// get performs an authenticated GET against the Sosen/Inteless API and
// returns the raw "data" payload.
//
// Every Sosen response is wrapped in a {code,msg,success,data} envelope, so
// a 200 with success:false is still a failure — unwrapped here so callers
// only ever see the payload.
func (a *Adapter) get(ctx context.Context, endpoint, path string) ([]byte, error) {
	token, err := a.tokens.Get(ctx)
	if err != nil {
		return nil, err
	}

	var env apiEnvelope
	_, err = a.client.Do(ctx, httpjson.Request{
		Method:   http.MethodGet,
		URL:      a.baseURL + path,
		Endpoint: endpoint,
		Header:   http.Header{"Authorization": []string{"Bearer " + token}},
	}, &env)
	if err != nil {
		if httpjson.Unauthorized(err) {
			// Token revoked early; force re-auth on the next call rather
			// than replaying a token the vendor has already rejected.
			a.tokens.Invalidate()
		}
		return nil, err
	}
	if !env.Success {
		return nil, fmt.Errorf("api error: %s", env.Msg)
	}
	return env.Data, nil
}

type plantSummary struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Status     int     `json:"status"` // 1 = online, 0 = offline
	Pac        float64 `json:"pac"`
	Efficiency float64 `json:"efficiency"`
	Etoday     float64 `json:"etoday"`
	Etotal     float64 `json:"etotal"`
	Address    string  `json:"address"`
}

type plantListData struct {
	Total int            `json:"total"`
	Infos []plantSummary `json:"infos"`
}

func (a *Adapter) listPlants(ctx context.Context) ([]plantSummary, error) {
	raw, err := a.get(ctx, "/api/v1/plants", "/api/v1/plants?page=1&limit=200&status=&type=&sortCol=&order=&countryCode=")
	if err != nil {
		return nil, fmt.Errorf("plant list: %w", err)
	}
	var data plantListData
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("plant list: decode: %w", err)
	}
	return data.Infos, nil
}

// Describe implements adapters.SiteDescriber from the same plant list call.
func (a *Adapter) Describe(ctx context.Context) ([]adapters.SiteDescriptor, error) {
	plants, err := a.listPlants(ctx)
	if err != nil {
		return nil, fmt.Errorf("sosen: %w", err)
	}
	out := make([]adapters.SiteDescriptor, 0, len(plants))
	for _, p := range plants {
		out = append(out, adapters.SiteDescriptor{
			BrandSiteID: strconv.FormatInt(p.ID, 10),
			Name:        p.Name,
			Location:    p.Address,
		})
	}
	return out, nil
}

type plantRealtime struct {
	Pac    float64 `json:"pac"`
	Etoday float64 `json:"etoday"`
	Etotal float64 `json:"etotal"`
	// Pointer, not float64: this key is simply absent from the realtime
	// payload for some plants (observed live on SARAH BULOBA and MUSEVE
	// SHRINE KITUI). Decoded into a value type, absent and a genuine
	// measured 0 both arrive as 0, and the adapter then reports a
	// confident "0 W" for a quantity the portal never sent — exactly the
	// fabricated-zero the site page's grid KPI was fixed to stop showing.
	GridPower    *float64 `json:"gridPower"`
	BatPower     *float64 `json:"batPower"`
	StoragePower float64  `json:"storagePower"`
	TotalPower   float64  `json:"totalPower"` // capacity, kW
	Efficiency   float64  `json:"efficiency"`
}

// negZero collapses negative zero to positive zero. Negating a measured 0
// (the common case: a plant sitting at exactly 0 W of grid flow) produces
// -0, which is numerically equal to 0 but persists through Postgres and
// renders as "-0" once it reaches JSON. Callers only ever want the sign to
// carry direction, and there is no direction at zero.
func negZero(f float64) float64 {
	if f == 0 {
		return 0
	}
	return f
}

type deviceCount struct {
	Warning int `json:"warning"`
	Fault   int `json:"fault"`
	Total   int `json:"total"`
	Normal  int `json:"normal"`
	Offline int `json:"offline"`
}

type inverterSummary struct {
	SN string `json:"sn"`
}

type inverterListData struct {
	Infos []inverterSummary `json:"infos"`
}

type inverterBattery struct {
	// SOC is returned as a JSON string (e.g. "60.0"), not a number —
	// confirmed live against the real API.
	SOC string `json:"soc"`
}

// FetchAll lists every plant on the account and enriches each with its
// realtime power/grid/battery reading and device health counts.
func (a *Adapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	plants, err := a.listPlants(ctx)
	if err != nil {
		return nil, fmt.Errorf("sosen: %w", err)
	}

	out := make([]models.SiteData, 0, len(plants))
	for _, p := range plants {
		id := strconv.FormatInt(p.ID, 10)
		data, err := a.fetchPlantData(ctx, p)
		if err != nil {
			// Unknown, not Offline: we failed to read the plant, which says
			// nothing about whether the plant is running. Offline is what
			// the alert engine escalates to a critical.
			slog.Warn("sosen: plant telemetry unavailable", "plant", id, "error", err)
			out = append(out, models.SiteData{BrandSiteID: id, Timestamp: time.Now(), Status: models.StatusUnknown})
			continue
		}
		out = append(out, data)
	}
	return out, nil
}

func (a *Adapter) fetchPlantData(ctx context.Context, p plantSummary) (models.SiteData, error) {
	id := strconv.FormatInt(p.ID, 10)

	status := models.StatusOnline
	if p.Status == 0 {
		status = models.StatusOffline
	}

	pac, etoday, etotal := p.Pac, p.Etoday, p.Etotal
	data := models.SiteData{
		BrandSiteID: id,
		Timestamp:   time.Now(),
		Power:       &pac,
		EnergyToday: &etoday,
		EnergyTotal: &etotal,
		Status:      status,
	}

	if raw, err := a.get(ctx, "/api/v1/plant/{id}/realtime", "/api/v1/plant/"+id+"/realtime?id="+id); err == nil {
		var rt plantRealtime
		if json.Unmarshal(raw, &rt) == nil {
			// Sosen reports gridPower negative when the plant is DRAWING from
			// the grid, which is the opposite of the convention the rest of
			// the platform uses (+import / -export, as Deye documents and as
			// Ingecon's FromGridToConsumption implies). Passing it through
			// unnormalized inverted every Sosen arrow and label: Oakfund with
			// pac=0, batPower=0 and gridPower=-930 is a house running its
			// 930 W load entirely off the grid, but rendered as "exporting".
			// Negate here so one convention holds fleet-wide.
			//
			// The load formula is unchanged and still balances: load is
			// PV plus whatever is imported, and -*rt.GridPower is that import.
			//
			// Both readings are gated on the key being present: load is
			// derived from gridPower, so without it there is no load figure
			// either, and guessing one would be the same fabrication.
			if rt.GridPower != nil {
				// negZero: negating a genuine 0 yields -0, which survives
				// into Postgres and marshals as "-0" in the API payload.
				grid := negZero(-*rt.GridPower)
				load := negZero(rt.Pac - *rt.GridPower) // best-effort; Sosen has no direct load field
				data.GridPower = &grid
				data.LoadPower = &load
			}
			data.Raw = raw
		}
	}

	// deviceCount is the authoritative per-plant health signal: any fault
	// escalates status regardless of what the plant-list summary said.
	if raw, err := a.get(ctx, "/api/v1/plant/{id}/deviceCount", "/api/v1/plant/"+id+"/deviceCount?invType="); err == nil {
		var dc deviceCount
		if json.Unmarshal(raw, &dc) == nil {
			if dc.Fault > 0 {
				data.Status = models.StatusError
			} else if dc.Warning > 0 && data.Status == models.StatusOnline {
				data.Status = models.StatusWarning
			} else if dc.Offline > 0 && dc.Normal == 0 {
				data.Status = models.StatusOffline
			}
		}
	}

	// Battery SOC requires looking up the plant's inverter SN. Note:
	// /api/v1/batt/plant/{id}/flag's "battStationFlag" was observed live to
	// be false on a plant whose own dashboard showed an active battery at
	// 54% SOC — it does NOT reliably mean "has battery hardware" (it may
	// track a separate multi-inverter "battery station" grouping feature
	// instead). So we always attempt the SOC lookup and simply ignore it
	// when the call fails or returns nothing, rather than gating on that
	// flag.
	if soc, ok := a.fetchBatterySOC(ctx, id); ok {
		data.SOC = &soc
	}

	return data, nil
}

func (a *Adapter) fetchBatterySOC(ctx context.Context, plantID string) (float64, bool) {
	raw, err := a.get(ctx, "/api/v1/plant/{id}/inverters", "/api/v1/plant/"+plantID+"/inverters?page=1&limit=1&status=&sn=&stationId="+plantID+"&type=")
	if err != nil {
		return 0, false
	}
	var invs inverterListData
	if json.Unmarshal(raw, &invs) != nil || len(invs.Infos) == 0 {
		return 0, false
	}
	sn := invs.Infos[0].SN

	raw, err = a.get(ctx, "/api/v1/inverter/battery/{sn}/realtime", "/api/v1/inverter/battery/"+sn+"/realtime?sn="+sn+"&lan=en")
	if err != nil {
		return 0, false
	}
	var bat inverterBattery
	if json.Unmarshal(raw, &bat) != nil {
		return 0, false
	}
	soc, err := strconv.ParseFloat(bat.SOC, 64)
	if err != nil {
		return 0, false
	}
	return soc, true
}
