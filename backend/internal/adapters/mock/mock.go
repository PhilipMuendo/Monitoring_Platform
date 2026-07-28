// Package mock generates realistic synthetic telemetry for demo/dev sites
// so the whole product — dashboard, alerts, historical charts, wall
// display — is fully demoable with zero real brand credentials. It
// implements the exact same models.BrandAdapter interface a real brand
// adapter does, so swapping mock for real is a one-line change in main.go.
package mock

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/models"
)

type demoSite struct {
	id         string
	name       string
	capacityKW float64
	location   string
	// deterministic per-site personality so the same site behaves the
	// same way across restarts, driven off wall-clock time rather than
	// mutable state.
	seed     int64
	scenario scenario
}

type scenario string

const (
	scenarioNormal          scenario = "normal"
	scenarioOffline         scenario = "offline"          // no data at all — offline alert
	scenarioFault           scenario = "fault"             // active inverter fault code
	scenarioLowBattery      scenario = "low_battery"        // SOC pinned low — battery alert
	scenarioProductionDrop  scenario = "production_drop"    // near-zero power during daylight
)

type Adapter struct {
	brand    models.Brand
	sites    []demoSite
	rateRPM  int
}

var kenyaCities = []string{
	"Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Malindi",
	"Kitale", "Garissa", "Nyeri", "Machakos", "Meru", "Kericho", "Naivasha",
	"Kakamega", "Kilifi", "Voi", "Isiolo", "Nanyuki", "Lamu", "Embu", "Kajiado",
}

var siteTypes = []string{
	"Rooftop", "Warehouse", "Estate", "Mall", "Factory", "Clinic", "School",
	"Farm", "Office Park", "Lodge", "Hospital", "Depot", "Complex", "Plaza",
}

// New builds a mock adapter for a single brand with count deterministic
// demo sites (stable brand_site_id/name/capacity across restarts, driven
// by a seeded RNG keyed on brand+index — not wall-clock random).
func New(brand models.Brand, count int, startIndex int) *Adapter {
	a := &Adapter{brand: brand, rateRPM: 120}
	seedBase := int64(0)
	for _, c := range string(brand) {
		seedBase += int64(c)
	}

	for i := 0; i < count; i++ {
		globalIdx := startIndex + i
		r := rand.New(rand.NewSource(seedBase + int64(globalIdx)*97))
		city := kenyaCities[globalIdx%len(kenyaCities)]
		typ := siteTypes[(globalIdx*3+1)%len(siteTypes)]

		capacity := 3.0 + r.Float64()*47.0 // 3kW - 50kW residential/commercial mix
		capacity = math.Round(capacity*10) / 10

		sc := scenarioNormal
		switch {
		case globalIdx%13 == 0:
			sc = scenarioOffline
		case globalIdx%17 == 0:
			sc = scenarioFault
		case globalIdx%11 == 0:
			sc = scenarioLowBattery
		case globalIdx%19 == 0:
			sc = scenarioProductionDrop
		}

		a.sites = append(a.sites, demoSite{
			id:         fmt.Sprintf("%s-%03d", brand, globalIdx+1),
			name:       fmt.Sprintf("%s %s", city, typ),
			capacityKW: capacity,
			location:   city + ", Kenya",
			seed:       seedBase + int64(globalIdx)*97,
			scenario:   sc,
		})
	}
	return a
}

func (a *Adapter) Name() string { return string(a.brand) }

func (a *Adapter) RateLimit() (int, time.Duration) { return a.rateRPM, time.Minute }

func (a *Adapter) ValidateCredentials(ctx context.Context) error { return nil }

func (a *Adapter) Describe(ctx context.Context) ([]adapters.SiteDescriptor, error) {
	out := make([]adapters.SiteDescriptor, 0, len(a.sites))
	for _, s := range a.sites {
		out = append(out, adapters.SiteDescriptor{
			BrandSiteID: s.id,
			Name:        s.name,
			CapacityKW:  s.capacityKW,
			Location:    s.location,
		})
	}
	return out, nil
}

func (a *Adapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	now := time.Now()
	out := make([]models.SiteData, 0, len(a.sites))
	for _, s := range a.sites {
		out = append(out, generateReading(s, now))
	}
	return out, nil
}

// generateReading produces a plausible reading for the given site at
// time t: a bell-curve PV output peaking at solar noon, a battery SOC
// that charges through the day and drains overnight, load roughly
// proportional to capacity with some jitter, and grid import/export
// balancing the difference — plus whatever scripted scenario the site
// was assigned, so the alert engine always has real problems to surface.
func generateReading(s demoSite, t time.Time) models.SiteData {
	r := rand.New(rand.NewSource(s.seed + t.Unix()/300)) // stable within a 5-min bucket

	hour := float64(t.Hour()) + float64(t.Minute())/60.0
	daylight := hour >= 6 && hour <= 18.5

	// Bell-curve solar output centered at 12:30, ~half-width 6h.
	pvFactor := math.Exp(-math.Pow(hour-12.5, 2) / (2 * math.Pow(3.2, 2)))
	if !daylight {
		pvFactor = 0
	}
	pvFactor *= 0.85 + r.Float64()*0.3 // cloud/weather jitter
	if pvFactor < 0 {
		pvFactor = 0
	}
	pvPower := s.capacityKW * 1000 * pvFactor

	loadBase := s.capacityKW * 1000 * (0.25 + 0.15*math.Sin(hour/24*2*math.Pi+1))
	loadPower := math.Max(200, loadBase*(0.8+r.Float64()*0.4))

	// SOC follows a smooth day/night cycle: charges 0.06-0.98 while pv>load, drains overnight.
	socCycle := 0.55 + 0.35*math.Sin((hour-6)/24*2*math.Pi)
	soc := math.Max(0.08, math.Min(0.98, socCycle+r.Float64()*0.04-0.02))

	status := models.StatusOnline
	faultCode := 0
	energyToday := math.Max(0, pvFactor*s.capacityKW*4.2*(hour/18.5))
	energyTotal := s.capacityKW * 1850 // rough lifetime kWh at an assumed install age

	// Scenario overrides must land before battery/grid are derived below —
	// otherwise a fault/production-drop site's grid and battery current
	// get computed from the pre-override (much larger) pvPower, producing
	// wildly unphysical values even though the reported Power field itself
	// looks right.
	switch s.scenario {
	case scenarioOffline:
		// Simulated stale/no data: caller (collector) treats an old
		// timestamp + offline status as "no data received."
		return models.SiteData{
			BrandSiteID: s.id,
			Timestamp:   t.Add(-25 * time.Minute),
			Status:      models.StatusOffline,
		}
	case scenarioFault:
		status = models.StatusError
		faultCode = 41
		pvPower *= 0.1
	case scenarioLowBattery:
		soc = 0.08 + r.Float64()*0.05
		status = models.StatusWarning
	case scenarioProductionDrop:
		if daylight {
			pvPower = r.Float64() * 30 // near-zero despite full daylight
			status = models.StatusWarning
		}
	}

	// Battery only absorbs/supplies up to its own rate limit (30% of
	// capacity as a rough C-rate stand-in) — whatever surplus or deficit
	// it can't cover spills to the grid. Power balance: pv + grid = load +
	// batteryPower (battery positive = charging/consuming, negative =
	// discharging/supplying; grid positive = importing, negative =
	// exporting), which rearranges to the gridPower line below.
	netPower := pvPower - loadPower
	maxBatteryRateW := s.capacityKW * 1000 * 0.3
	batteryPower := math.Max(-maxBatteryRateW, math.Min(maxBatteryRateW, netPower))
	gridPower := loadPower + batteryPower - pvPower
	if math.Abs(gridPower) < 1 {
		gridPower = 0
	}

	socOut := soc * 100
	battV := 48 + soc*4
	battI := batteryPower / math.Max(battV, 1)
	grid := gridPower
	load := loadPower
	fault := faultCode

	return models.SiteData{
		BrandSiteID: s.id,
		Timestamp:   t,
		Power:       math.Round(pvPower),
		EnergyToday: math.Round(energyToday*100) / 100,
		EnergyTotal: math.Round(energyTotal*100) / 100,
		SOC:         &socOut,
		BatteryV:    &battV,
		BatteryI:    &battI,
		GridPower:   &grid,
		LoadPower:   &load,
		FaultCode:   &fault,
		Status:      status,
	}
}
