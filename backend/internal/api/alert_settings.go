package api

import (
	"log/slog"
	"net/http"

	"solar-monitor/internal/alertengine"
	"solar-monitor/internal/auth"
	"solar-monitor/internal/models"
)

// alertSettingsResponse is the stored policy plus the values it DERIVES.
//
// The derived block exists because the two windows are stored as durations and
// enforced as reading counts, and an operator who cannot see that conversion
// cannot reason about what they just set. "30 minutes" silently becoming
// "6 readings" is exactly the coupling this feature was built to expose, so
// the UI shows both halves and the poll interval that links them.
type alertSettingsResponse struct {
	models.AlertSettings
	Derived alertSettingsDerived `json:"derived"`
}

type alertSettingsDerived struct {
	PollIntervalSeconds  int `json:"poll_interval_seconds"`
	ProductionDropWindow int `json:"production_drop_window_readings"`
	BatteryWindow        int `json:"battery_window_readings"`
}

func (d *Deps) deriveAlertSettings(s models.AlertSettings) alertSettingsResponse {
	poll := d.Cfg.PollInterval
	return alertSettingsResponse{
		AlertSettings: s,
		Derived: alertSettingsDerived{
			PollIntervalSeconds:  int(poll.Seconds()),
			ProductionDropWindow: models.WindowReadings(s.ProductionDropWindowSeconds, poll),
			BatteryWindow:        models.WindowReadings(s.BatteryWindowSeconds, poll),
		},
	}
}

// handleGetAlertSettings is GET /api/v1/admin/alert-settings.
func (d *Deps) handleGetAlertSettings(w http.ResponseWriter, r *http.Request) {
	s, err := d.AlertSettings.Load(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load alert settings")
		return
	}
	writeJSON(w, http.StatusOK, d.deriveAlertSettings(s))
}

// handleUpdateAlertSettings is PUT /api/v1/admin/alert-settings.
//
// A full replace rather than a PATCH, deliberately. Several of these values
// are only valid RELATIVE to one another — the two hysteresis bands, and the
// windows against the poll interval — so validating a partial update means
// merging it with the stored row first and validating that. A PUT makes the
// submitted document the whole policy, which is also what the admin form
// actually sends.
func (d *Deps) handleUpdateAlertSettings(w http.ResponseWriter, r *http.Request) {
	var req models.AlertSettings
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validated against the LIVE poll interval, because that is what the
	// windows will be converted against a few lines below.
	if err := req.Validate(d.Cfg.PollInterval); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	actor, _ := auth.UserFromContext(r.Context())
	saved, err := d.AlertSettings.Save(r.Context(), req, actor.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save alert settings")
		return
	}

	// Apply immediately. Persisting without swapping the live config would
	// leave the UI showing thresholds the engine is not using until the next
	// restart — a discrepancy nothing on screen would reveal.
	if d.AlertEngine != nil {
		cfg := alertengine.ConfigFromSettings(saved, d.Cfg.PollInterval, d.AlertEngine.Config())
		d.AlertEngine.SetConfig(cfg)
		slog.Info("alert settings updated",
			"actor", actor.ID,
			"production_window_readings", cfg.ProductionDropWindow,
			"battery_window_readings", cfg.BatteryWindow)
	}

	d.Audit.Log(r.Context(), actor.ID, "alert_settings.update", "alert_settings", "", nil)

	writeJSON(w, http.StatusOK, d.deriveAlertSettings(saved))
}
