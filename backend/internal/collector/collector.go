// Package collector runs the 5-minute polling cycle described in the
// brief: fan out to every brand adapter in parallel, normalize+store
// each site's reading, and feed it to the alert engine.
package collector

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/alertengine"
	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

type BrandStats struct {
	Online  int `json:"online"`
	Offline int `json:"offline"`
}

type CycleStats struct {
	StartedAt   time.Time             `json:"started_at"`
	DurationMS  int64                 `json:"duration_ms"`
	SitesPolled int                   `json:"sites_polled"`
	Errors      int                   `json:"errors"`
	ByBrand     map[string]BrandStats `json:"brands"`
}

type Collector struct {
	adapters       []models.BrandAdapter
	sites          *storage.SiteRepo
	metrics        *storage.MetricsRepo
	alerts         *alertengine.Engine
	pollInterval   time.Duration
	maxConcurrency int

	mu        sync.RWMutex
	lastRun   time.Time
	lastStats CycleStats
}

func New(adapterList []models.BrandAdapter, sites *storage.SiteRepo, metrics *storage.MetricsRepo, alerts *alertengine.Engine, pollInterval time.Duration) *Collector {
	return &Collector{
		adapters:       adapterList,
		sites:          sites,
		metrics:        metrics,
		alerts:         alerts,
		pollInterval:   pollInterval,
		maxConcurrency: 10,
	}
}

// Run polls once immediately (so the dashboard isn't empty for the first
// 5 minutes after boot) then blocks, polling every pollInterval until ctx
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

func (c *Collector) runCycle(ctx context.Context) {
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
			stats.SitesPolled += brandStats.Online + brandStats.Offline
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

	slog.Info("poll cycle completed", "sites", stats.SitesPolled, "duration_ms", stats.DurationMS, "errors", stats.Errors)
}

// pollAdapter handles one brand: optional auto-discovery, then a bounded
// fan-out over every site the brand adapter returned readings for.
func (c *Collector) pollAdapter(ctx context.Context, a models.BrandAdapter) (BrandStats, int) {
	brand := models.Brand(a.Name())
	stats := BrandStats{}
	errCount := 0

	if describer, ok := a.(adapters.SiteDescriber); ok {
		descriptors, err := describer.Describe(ctx)
		if err != nil {
			slog.Warn("describe failed", "brand", brand, "error", err)
			errCount++
		} else {
			for _, d := range descriptors {
				if err := c.sites.UpsertDiscovered(ctx, brand, d); err != nil {
					slog.Warn("upsert discovered site failed", "brand", brand, "site", d.BrandSiteID, "error", err)
				}
			}
		}
	}

	readings, err := a.FetchAll(ctx)
	if err != nil {
		slog.Error("adapter fetch failed", "brand", brand, "error", err)
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

			online, hadErr := c.processReading(ctx, brand, reading)
			mu.Lock()
			if online {
				stats.Online++
			} else {
				stats.Offline++
			}
			if hadErr {
				errCount++
			}
			mu.Unlock()
		}(reading)
	}
	wg.Wait()

	return stats, errCount
}

func (c *Collector) processReading(ctx context.Context, brand models.Brand, reading models.SiteData) (online bool, hadErr bool) {
	siteID, name, err := c.sites.ResolveSite(ctx, brand, reading.BrandSiteID)
	if err != nil {
		if err != storage.ErrNotFound {
			slog.Error("resolve site failed", "brand", brand, "brand_site_id", reading.BrandSiteID, "error", err)
			hadErr = true
		}
		return false, hadErr
	}

	if err := c.sites.UpsertStatus(ctx, siteID, reading); err != nil {
		slog.Error("upsert site status failed", "site_id", siteID, "error", err)
		hadErr = true
	}
	if err := c.metrics.Insert(ctx, siteID, reading); err != nil {
		slog.Error("insert metric failed", "site_id", siteID, "error", err)
		hadErr = true
	}
	if c.alerts != nil {
		if err := c.alerts.Evaluate(ctx, siteID, name, reading); err != nil {
			slog.Error("alert evaluation failed", "site_id", siteID, "error", err)
			hadErr = true
		}
	}

	return reading.Status == models.StatusOnline || reading.Status == models.StatusWarning, hadErr
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
