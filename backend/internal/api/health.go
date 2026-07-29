package api

import (
	"context"
	"net/http"
	"time"
)

// handleHealth reports whether this instance can actually do its job.
//
// The previous version discarded every error it produced
// (`activeAlerts, _ := ...`) and never touched the database directly, so it
// answered 200 {"status":"healthy"} with Postgres completely down. That is
// the one endpoint an orchestrator trusts to decide whether to keep routing
// traffic here, and it was structurally incapable of saying no.
//
// Now:
//   - the DB is pinged on a short timeout and a failure decides the verdict
//     (503, so a load balancer takes the instance out of rotation);
//   - a stalled collector degrades but does not fail — the API is still
//     serving correct historical data, and pulling the instance would help
//     nobody;
//   - counts that fail to load are reported as null rather than zero,
//     because "0 active alerts" and "we could not read the alerts table"
//     must never look identical on a status page.
func (d *Deps) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	status := "healthy"
	httpStatus := http.StatusOK
	checks := map[string]any{}

	dbStart := time.Now()
	if err := d.DB.Pool.Ping(ctx); err != nil {
		checks["database"] = map[string]any{"ok": false, "error": err.Error()}
		status = "unhealthy"
		httpStatus = http.StatusServiceUnavailable
	} else {
		checks["database"] = map[string]any{"ok": true, "latency_ms": time.Since(dbStart).Milliseconds()}
	}

	var activeAlerts, alerts24h any
	if httpStatus == http.StatusOK {
		if n, err := d.Alerts.CountActive(ctx); err == nil {
			activeAlerts = n
		}
		if n, err := d.Alerts.CountSince(ctx, 24*time.Hour); err == nil {
			alerts24h = n
		}
	}

	stats := d.Collector.Stats()
	brands := make(map[string]map[string]int, len(stats.ByBrand))
	totalSites := 0
	for brand, bs := range stats.ByBrand {
		brands[brand] = map[string]int{
			"online":  bs.Online,
			"offline": bs.Offline,
			// Surfaced separately so a vendor API outage can't be misread
			// as half the fleet going dark.
			"unknown": bs.Unknown,
		}
		totalSites += bs.Online + bs.Offline + bs.Unknown
	}

	successRate := 1.0
	if stats.SitesPolled > 0 {
		successRate = 1 - float64(stats.Errors)/float64(stats.SitesPolled)
	}

	lastRun := d.Collector.LastRun()
	collectorOK := true
	if !lastRun.IsZero() && time.Since(lastRun) > 2*d.Cfg.PollInterval {
		collectorOK = false
		if status == "healthy" {
			status = "degraded"
		}
	}
	checks["collector"] = map[string]any{"ok": collectorOK, "last_run": lastRun}

	writeJSON(w, httpStatus, map[string]any{
		"status":    status,
		"timestamp": time.Now().UTC(),
		"checks":    checks,
		"metrics": map[string]any{
			"last_collection": lastRun,
			"total_sites":     totalSites,
			"success_rate":    successRate,
			"avg_duration_ms": stats.DurationMS,
			"brands":          brands,
			"alerts_active":   activeAlerts,
			"alerts_24h":      alerts24h,
		},
	})
}

// handleLiveness answers "is this process running", nothing more.
//
// Deliberately does not touch the database: a liveness probe that fails
// during a DB outage makes the orchestrator restart every replica in a
// loop, turning a recoverable dependency failure into a crash cascade.
// Dependencies belong in readiness (handleHealth), not liveness.
func (d *Deps) handleLiveness(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "alive",
		"uptime": time.Since(d.StartedAt).String(),
	})
}
