package api

import (
	"net/http"
	"time"
)

// handleHealth matches the JSON shape specified in the project brief.
func (d *Deps) handleHealth(w http.ResponseWriter, r *http.Request) {
	stats := d.Collector.Stats()
	activeAlerts, _ := d.Alerts.CountActive(r.Context())
	alerts24h, _ := d.Alerts.CountSince(r.Context(), 24*time.Hour)

	brands := make(map[string]map[string]int, len(stats.ByBrand))
	totalSites := 0
	for brand, bs := range stats.ByBrand {
		brands[brand] = map[string]int{"online": bs.Online, "offline": bs.Offline}
		totalSites += bs.Online + bs.Offline
	}

	successRate := 1.0
	if stats.SitesPolled > 0 {
		successRate = 1 - float64(stats.Errors)/float64(stats.SitesPolled)
	}

	status := "healthy"
	if !d.Collector.LastRun().IsZero() && time.Since(d.Collector.LastRun()) > 2*d.Cfg.PollInterval {
		status = "degraded"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    status,
		"timestamp": time.Now().UTC(),
		"metrics": map[string]any{
			"last_collection": d.Collector.LastRun(),
			"total_sites":     totalSites,
			"success_rate":    successRate,
			"avg_duration_ms": stats.DurationMS,
			"brands":          brands,
			"alerts_active":   activeAlerts,
			"alerts_24h":      alerts24h,
		},
	})
}

func (d *Deps) handleLiveness(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
