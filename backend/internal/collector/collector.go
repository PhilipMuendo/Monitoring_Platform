// Package collector runs the polling cycle described in the brief: fan out
// to every brand adapter in parallel, normalize+store each site's reading,
// and feed it to the alert engine.
package collector

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/alertengine"
	"solar-monitor/internal/models"
	"solar-monitor/internal/observability"
	"solar-monitor/internal/storage"
)

type BrandStats struct {
	Online  int `json:"online"`
	Offline int `json:"offline"`
	// Unknown counts sites we failed to read this cycle. Kept separate from
	// Offline so "the vendor API is down" can't masquerade as "half the
	// fleet just went dark" on the health endpoint.
	Unknown int  `json:"unknown"`
	Failed  bool `json:"failed"`
}

type CycleStats struct {
	StartedAt   time.Time             `json:"started_at"`
	DurationMS  int64                 `json:"duration_ms"`
	SitesPolled int                   `json:"sites_polled"`
	Errors      int                   `json:"errors"`
	ByBrand     map[string]BrandStats `json:"brands"`
}

type Collector struct {
	adapters     []models.BrandAdapter
	sites        *storage.SiteRepo
	readings     *storage.ReadingStore
	alerts       *alertengine.Engine
	metrics      *observability.Metrics
	pollInterval time.Duration
	// maxConcurrency bounds in-flight per-site work *within* one brand.
	// Brands run concurrently with each other on top of this.
	maxConcurrency int
	// cycleTimeout stops a wedged vendor API from holding a cycle open
	// past the next tick. Without it a hung connection could stack cycles
	// until the process runs out of goroutines.
	cycleTimeout time.Duration

	mu        sync.RWMutex
	lastRun   time.Time
	lastStats CycleStats
}

type Options struct {
	PollInterval   time.Duration
	MaxConcurrency int
	CycleTimeout   time.Duration
	Metrics        *observability.Metrics
}

func New(adapterList []models.BrandAdapter, sites *storage.SiteRepo, readings *storage.ReadingStore, alerts *alertengine.Engine, opts Options) *Collector {
	if opts.MaxConcurrency <= 0 {
		opts.MaxConcurrency = 10
	}
	if opts.CycleTimeout <= 0 {
		// Generous relative to the poll interval but strictly under it, so
		// a stuck cycle is abandoned before the next one starts.
		opts.CycleTimeout = opts.PollInterval - opts.PollInterval/5
		if opts.CycleTimeout <= 0 {
			opts.CycleTimeout = 4 * time.Minute
		}
	}
	if opts.Metrics == nil {
		opts.Metrics = observability.NewMetrics()
	}
	return &Collector{
		adapters:       adapterList,
		sites:          sites,
		readings:       readings,
		alerts:         alerts,
		metrics:        opts.Metrics,
		pollInterval:   opts.PollInterval,
		maxConcurrency: opts.MaxConcurrency,
		cycleTimeout:   opts.CycleTimeout,
	}
}

// Run polls once immediately (so the dashboard isn't empty for the first
// interval after boot) then blocks, polling every pollInterval until ctx
// is cancelled.
func (c *Collector) Run(ctx context.Context) {
	c.runCycle(ctx)

	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.runCycle(ctx)
		}
	}
}

func (c *Collector) runCycle(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, c.cycleTimeout)
	defer cancel()

	start := time.Now()
	stats := CycleStats{StartedAt: start, ByBrand: map[string]BrandStats{}}
	var statsMu sync.Mutex

	var wg sync.WaitGroup
	for _, a := range c.adapters {
		wg.Add(1)
		go func(a models.BrandAdapter) {
			defer wg.Done()
			brandStats, errCount := c.pollAdapter(ctx, a)
			statsMu.Lock()
			stats.ByBrand[a.Name()] = brandStats
			stats.SitesPolled += brandStats.Online + brandStats.Offline + brandStats.Unknown
			stats.Errors += errCount
			statsMu.Unlock()
		}(a)
	}
	wg.Wait()

	stats.DurationMS = time.Since(start).Milliseconds()

	c.mu.Lock()
	c.lastRun = start
	c.lastStats = stats
	c.mu.Unlock()

	c.metrics.ObserveCycle(time.Since(start), stats.SitesPolled, stats.Errors)
	for brand, bs := range stats.ByBrand {
		c.metrics.ObserveBrandCycle(brand, bs.Online, bs.Offline, bs.Unknown, bs.Failed)
	}

	slog.Info("poll cycle completed",
		"sites", stats.SitesPolled, "duration_ms", stats.DurationMS, "errors", stats.Errors)
}

// discoverAdapter runs the optional site auto-registration step for one
// brand, so a plant added in the brand's own portal shows up in the fleet
// on the next cycle without anyone re-typing it into the admin UI.
func (c *Collector) discoverAdapter(ctx context.Context, a models.BrandAdapter) error {
	describer, ok := a.(adapters.SiteDescriber)
	if !ok {
		return nil
	}
	brand := models.Brand(a.Name())
	descriptors, err := describer.Describe(ctx)
	if err != nil {
		slog.Warn("describe failed", "brand", brand, "error", err)
		return err
	}
	for _, d := range descriptors {
		if err := c.sites.UpsertDiscovered(ctx, brand, d); err != nil {
			slog.Warn("upsert discovered site failed", "brand", brand, "site", d.BrandSiteID, "error", err)
		}
	}
	return nil
}

// pollAdapter handles one brand: optional auto-discovery, then a bounded
// fan-out over every site the brand adapter returned readings for.
//
// When FetchAll fails outright we no longer simply return. Every site of
// that brand would otherwise receive no write at all and quietly rot until
// it crossed the offline threshold, at which point the whole brand alerts
// at once — the worst possible moment to discover a vendor outage. Instead
// the brand's known sites are marked StatusUnknown, which the dashboard
// renders honestly and the alert engine ignores.
func (c *Collector) pollAdapter(ctx context.Context, a models.BrandAdapter) (BrandStats, int) {
	brand := models.Brand(a.Name())
	stats := BrandStats{}
	errCount := 0

	if err := c.discoverAdapter(ctx, a); err != nil {
		errCount++
	}

	readings, err := a.FetchAll(ctx)
	if err != nil {
		slog.Error("adapter fetch failed", "brand", brand, "error", err)
		stats.Failed = true
		stats.Unknown = c.markBrandUnknown(ctx, brand)
		return stats, errCount + 1
	}

	sem := make(chan struct{}, c.maxConcurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, reading := range readings {
		wg.Add(1)
		sem <- struct{}{}
		go func(reading models.SiteData) {
			defer wg.Done()
			defer func() { <-sem }()

			outcome, hadErr := c.processReading(ctx, brand, reading)
			mu.Lock()
			switch outcome {
			case outcomeOnline:
				stats.Online++
			case outcomeUnknown:
				stats.Unknown++
			default:
				stats.Offline++
			}
			if hadErr {
				errCount++
			}
			mu.Unlock()
		}(reading)
	}
	wg.Wait()

	c.markMissingUnknown(ctx, brand, readings, &stats)

	return stats, errCount
}

// markMissingUnknown flags any active, registered site of this brand that
// FetchAll did not return a reading for this cycle.
//
// A site can vanish from a vendor's plant list — deleted or unlinked in
// their portal — while the rest of the brand's sites are still read
// successfully, so markBrandUnknown's all-or-nothing failure path never
// catches it. Without this, such a site never receives another write and
// its status (and any alert state) freezes forever at whatever it last
// was, silently, since nothing else re-checks it independently.
func (c *Collector) markMissingUnknown(ctx context.Context, brand models.Brand, readings []models.SiteData, stats *BrandStats) {
	if c.sites == nil || c.readings == nil {
		return
	}

	registered, err := c.sites.IDsByBrandKeyed(ctx, brand)
	if err != nil {
		slog.Error("could not list registered sites to check for missing ones", "brand", brand, "error", err)
		return
	}

	seen := make(map[string]struct{}, len(readings))
	for _, r := range readings {
		seen[r.BrandSiteID] = struct{}{}
	}

	for brandSiteID, id := range registered {
		if _, ok := seen[brandSiteID]; ok {
			continue
		}
		if err := c.readings.RecordStatusOnly(ctx, id, models.StatusUnknown); err != nil {
			slog.Warn("mark missing site unknown failed", "site_id", id, "error", err)
			continue
		}
		stats.Unknown++
	}
}

// markBrandUnknown flags every registered site of a brand as unreachable
// after a total fetch failure, and reports how many were touched.
func (c *Collector) markBrandUnknown(ctx context.Context, brand models.Brand) int {
	// This runs on the failure path, so it must be the most defensive code
	// in the package: a panic here would take the process down during a
	// vendor outage — precisely the moment the rest of the fleet still
	// needs collecting.
	if c.sites == nil || c.readings == nil {
		return 0
	}

	ids, err := c.sites.IDsByBrand(ctx, brand)
	if err != nil {
		slog.Error("could not list sites to mark unknown", "brand", brand, "error", err)
		return 0
	}
	for _, id := range ids {
		if err := c.readings.RecordStatusOnly(ctx, id, models.StatusUnknown); err != nil {
			slog.Warn("mark unknown failed", "site_id", id, "error", err)
		}
	}
	return len(ids)
}

type outcome int

const (
	outcomeOffline outcome = iota
	outcomeOnline
	outcomeUnknown
)

func (c *Collector) processReading(ctx context.Context, brand models.Brand, reading models.SiteData) (outcome, bool) {
	siteID, name, err := c.sites.ResolveSite(ctx, brand, reading.BrandSiteID)
	if err != nil {
		if err != storage.ErrNotFound {
			slog.Error("resolve site failed", "brand", brand, "brand_site_id", reading.BrandSiteID, "error", err)
			return outcomeOffline, true
		}
		// Either not registered yet (no describer picked it up) or an
		// admin deactivated it — either way, nothing to write.
		return outcomeOffline, false
	}

	// A reading we could not obtain is not a data point. Recording it in
	// site_metrics would push a phantom row into every chart and into the
	// production-drop rule's rolling window, so unknown updates the status
	// only and leaves last_seen_at where it was.
	if reading.Status == models.StatusUnknown {
		if err := c.readings.RecordStatusOnly(ctx, siteID, models.StatusUnknown); err != nil {
			slog.Error("record unknown status failed", "site_id", siteID, "error", err)
			return outcomeUnknown, true
		}
		return outcomeUnknown, false
	}

	hadErr := false
	if err := c.readings.Record(ctx, siteID, reading); err != nil {
		slog.Error("record reading failed", "site_id", siteID, "error", err)
		hadErr = true
	}

	// Alerts run outside the write transaction on purpose: the engine
	// publishes SSE events as a side effect, and those must not fire for a
	// transaction that later rolls back.
	if c.alerts != nil {
		if err := c.alerts.Evaluate(ctx, siteID, name, reading); err != nil {
			slog.Error("alert evaluation failed", "site_id", siteID, "error", err)
			hadErr = true
		}
	}

	if reading.Status == models.StatusOnline || reading.Status == models.StatusWarning {
		return outcomeOnline, hadErr
	}
	return outcomeOffline, hadErr
}

func (c *Collector) Stats() CycleStats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastStats
}

func (c *Collector) LastRun() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastRun
}
