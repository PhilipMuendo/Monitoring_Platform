package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/storage"
)

func (d *Deps) handleListSites(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("all") != "true"
	sites, err := d.Sites.List(r.Context(), activeOnly)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sites")
		return
	}
	writeJSON(w, http.StatusOK, sites)
}

func (d *Deps) handleFleetSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := d.Sites.FleetSummary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to compute fleet summary")
		return
	}
	activeAlerts, _ := d.Alerts.CountActive(r.Context())
	summary.ActiveAlerts = activeAlerts
	writeJSON(w, http.StatusOK, summary)
}

func (d *Deps) handleGetSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	site, err := d.Sites.GetByID(r.Context(), id)
	if err != nil {
		if err == storage.ErrNotFound {
			writeError(w, http.StatusNotFound, "site not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load site")
		return
	}
	writeJSON(w, http.StatusOK, site)
}

// handleSiteHistory serves the brief's 24h/7d/30d power-curve views via
// ?range=24h|7d|30d, using raw 5-minute data for 24h and the hourly
// continuous aggregate for the longer windows.
func (d *Deps) handleSiteHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rng := r.URL.Query().Get("range")
	if rng == "" {
		rng = "24h"
	}

	var (
		points any
		err    error
	)

	switch rng {
	case "24h":
		points, err = d.Metrics.History24h(r.Context(), id)
	case "7d":
		points, err = d.Metrics.HistoryHourly(r.Context(), id, 7*24*time.Hour)
	case "30d":
		points, err = d.Metrics.HistoryHourly(r.Context(), id, 30*24*time.Hour)
	default:
		writeError(w, http.StatusBadRequest, "range must be one of: 24h, 7d, 30d")
		return
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"range": rng, "points": points})
}

func (d *Deps) handleSiteAlerts(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	alerts, err := d.Alerts.ListForSite(r.Context(), id, 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load site alerts")
		return
	}
	writeJSON(w, http.StatusOK, alerts)
}
