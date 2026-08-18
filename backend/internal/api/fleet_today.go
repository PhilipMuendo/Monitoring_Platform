package api

import (
	"net/http"
	"time"

	"solar-monitor/internal/storage"
)

// fleetCurveBucket is the resolution of the wall display's day curve.
//
// 15 minutes gives at most 96 points across a day. That is enough to show the
// shape of a solar day — the morning ramp, the midday plateau, a cloud passing
// — and few enough that the whole series is a few kilobytes and the SVG the
// wall draws stays cheap. The raw 5-minute readings would triple the payload
// to render detail no one can see from across a room.
const fleetCurveBucket = 15 * time.Minute

type fleetTodayResponse struct {
	DayStart      time.Time            `json:"day_start"`
	BucketMinutes int                  `json:"bucket_minutes"`
	Points        []storage.FleetPoint `json:"points"`

	EnergyTodayKWh float64 `json:"energy_today_kwh"`
	// EnergyYesterdayToNowKWh is yesterday's generation up to the SAME CLOCK
	// TIME, and it is the only fair thing to put a percentage against.
	//
	// Comparing today-so-far with yesterday's full total is the classic way a
	// dashboard lies: at 09:00 it would report "-85% vs yesterday" every
	// single morning on a perfectly healthy fleet, and by evening the same
	// number would drift back to zero. A figure that is alarming at breakfast
	// and fine after lunch teaches people to ignore it.
	EnergyYesterdayToNowKWh float64 `json:"energy_yesterday_to_now_kwh"`
	// EnergyYesterdayTotalKWh is the whole of yesterday, for context rather
	// than for the delta.
	EnergyYesterdayTotalKWh float64 `json:"energy_yesterday_total_kwh"`
}

// handleFleetToday is GET /api/v1/fleet/today: the fleet's generation curve
// for the local day so far, plus the energy comparison that goes beside it.
//
// One endpoint rather than two because they are always read together, share
// the same day boundary, and a wall display refetching on a timer should make
// one request rather than two that can disagree about where "today" starts.
func (d *Deps) handleFleetToday(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := time.Now()

	todayStart, _ := storage.FleetDay(now)
	yesterdayStart, yesterdayEnd := storage.FleetDay(now.AddDate(0, 0, -1))
	// The same offset into yesterday that we are into today. Half-open, so a
	// reading exactly at "now yesterday" is excluded from both sides equally.
	yesterdayToNow := yesterdayStart.Add(now.Sub(todayStart))

	points, err := d.SiteMetrics.FleetPowerCurve(ctx, todayStart, now, fleetCurveBucket)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the fleet curve")
		return
	}

	// A failure on either energy figure is reported as an error rather than
	// as 0: "the fleet generated nothing" and "we could not read it" must not
	// render as the same number on a wall nobody is standing at. Same
	// reasoning as the null counts in handleHealth.
	today, err := d.SiteMetrics.FleetEnergyKWh(ctx, todayStart, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load today's energy")
		return
	}
	yToNow, err := d.SiteMetrics.FleetEnergyKWh(ctx, yesterdayStart, yesterdayToNow)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load yesterday's energy")
		return
	}
	yTotal, err := d.SiteMetrics.FleetEnergyKWh(ctx, yesterdayStart, yesterdayEnd)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load yesterday's energy")
		return
	}

	writeJSON(w, http.StatusOK, fleetTodayResponse{
		DayStart:                todayStart,
		BucketMinutes:           int(fleetCurveBucket.Minutes()),
		Points:                  points,
		EnergyTodayKWh:          today,
		EnergyYesterdayToNowKWh: yToNow,
		EnergyYesterdayTotalKWh: yTotal,
	})
}
