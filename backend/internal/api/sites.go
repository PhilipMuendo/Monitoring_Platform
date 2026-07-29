package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/storage"
)

// handleListSites returns a page of sites.
//
// Paged rather than unbounded: both the dashboard and the wall display
// refetch this every poll interval, so an unbounded response puts the
// entire fleet on the wire twice per cycle per viewer. `total` comes back
// alongside so the client can page without a second call.
func (d *Deps) handleListSites(w http.ResponseWriter, r *http.Request) {
	page, err := d.Sites.List(r.Context(), storage.ListParams{
		ActiveOnly: r.URL.Query().Get("all") != "true",
		Limit:      queryInt(r, "limit", 0),
		Offset:     queryInt(r, "offset", 0),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sites")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// queryInt reads a bounded integer query parameter, falling back on
// anything unparseable rather than erroring — a malformed ?limit= should
// serve a sensible page, not a 400.
func queryInt(r *http.Request, key string, fallback int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
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
		points, err = d.SiteMetrics.History24h(r.Context(), id)
	case "7d":
		points, err = d.SiteMetrics.HistoryHourly(r.Context(), id, 7*24*time.Hour)
	case "30d":
		points, err = d.SiteMetrics.HistoryHourly(r.Context(), id, 30*24*time.Hour)
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
