package api

import (
	"context"
	"net/http"

	"solar-monitor/internal/auth"
	"solar-monitor/internal/models"
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

// handleListAlertHistory is the standalone alert history page's data
// source — every alert fleet-wide, active or resolved, newest first, with
// the timestamps the dashboard's relative-time issues panel doesn't show.
func (d *Deps) handleListAlertHistory(w http.ResponseWriter, r *http.Request) {
	page, err := d.Alerts.ListHistory(r.Context(), storage.HistoryParams{
		Limit:  queryInt(r, "limit", 0),
		Offset: queryInt(r, "offset", 0),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list alert history")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// handleAcknowledgeAlert closes the alert (see storage.AlertRepo.Acknowledge
// for why acknowledgement also resolves it) and pushes the update to any
// connected SSE clients so it disappears from the issues panel live.
func (d *Deps) handleAcknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUIDParam(w, r, "id")
	if !ok {
		return
	}
	u, _ := auth.UserFromContext(r.Context())

	alert, err := d.acknowledgeAlert(r.Context(), id, u.ID, "dashboard")
	if err != nil {
		if err == storage.ErrNotFound {
			writeError(w, http.StatusNotFound, "alert not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to acknowledge alert")
		return
	}

	writeJSON(w, http.StatusOK, alert)
}

// acknowledgeAlert is shared by the HTTP acknowledge endpoint and the chat
// tool call (chat.go) so the audit trail and the live SSE update stay
// consistent no matter which surface triggered it. source is recorded in
// the audit details ("dashboard" or "chat").
func (d *Deps) acknowledgeAlert(ctx context.Context, alertID, actorID, source string) (models.Alert, error) {
	alert, err := d.Alerts.Acknowledge(ctx, alertID, actorID)
	if err != nil {
		return alert, err
	}
	d.Audit.Log(ctx, actorID, "alert.acknowledge", "alert", alertID, map[string]string{"source": source})
	d.SSEHub.Publish("alert.acknowledged", alert)
	return alert, nil
}
