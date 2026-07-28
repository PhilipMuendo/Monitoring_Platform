package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/auth"
	"solar-monitor/internal/storage"
)

func (d *Deps) handleListActiveAlerts(w http.ResponseWriter, r *http.Request) {
	alerts, err := d.Alerts.ListActive(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	writeJSON(w, http.StatusOK, alerts)
}

// handleAcknowledgeAlert closes the alert (see storage.AlertRepo.Acknowledge
// for why acknowledgement also resolves it) and pushes the update to any
// connected SSE clients so it disappears from the issues panel live.
func (d *Deps) handleAcknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	u, _ := auth.UserFromContext(r.Context())

	alert, err := d.Alerts.Acknowledge(r.Context(), id, u.ID)
	if err != nil {
		if err == storage.ErrNotFound {
			writeError(w, http.StatusNotFound, "alert not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to acknowledge alert")
		return
	}

	d.Audit.Log(r.Context(), u.ID, "alert.acknowledge", "alert", id, nil)
	d.SSEHub.Publish("alert.acknowledged", alert)

	writeJSON(w, http.StatusOK, alert)
}
