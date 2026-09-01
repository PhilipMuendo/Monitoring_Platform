// Package api wires the HTTP surface: chi router, request/response
// handling, auth middleware, and the SSE alert stream. Deps holds every
// repository/service a handler might need; handlers are methods on *Deps
// so they read like a cohesive controller layer without a DI framework.
package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/adapters/gemini"
	"solar-monitor/internal/alertengine"
	"solar-monitor/internal/auth"
	"solar-monitor/internal/collector"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
	"solar-monitor/internal/observability"
	"solar-monitor/internal/storage"
)

type Deps struct {
	Cfg *config.Config
	DB  *storage.DB
	// SiteMetrics is the metrics *repository* (history queries). Named to
	// keep it distinct from Metrics, the Prometheus registry.
	Sites         *storage.SiteRepo
	SiteMetrics   *storage.MetricsRepo
	Alerts        *storage.AlertRepo
	AlertSettings *storage.AlertSettingsRepo
	// AlertEngine is held so an admin editing thresholds can swap the live
	// policy without a restart. Nil in tests that do not exercise that path.
	AlertEngine   *alertengine.Engine
	Users         *storage.UserRepo
	Audit         *storage.AuditRepo
	AuthService   *auth.Service
	TokenIssuer   *auth.TokenIssuer
	LoginThrottle *auth.Throttle
	Collector     *collector.Collector
	Metrics       *observability.Metrics
	SSEHub        *SSEHub
	// Gemini is nil when GEMINI_API_KEY is unset — handleChat returns 503
	// in that case rather than the server refusing to boot, since chat is
	// additive, not core telemetry.
	Gemini      *gemini.Client
	ChatLimiter *chatLimiter
	// Describers lets admin site-creation validate a brand_site_id against
	// the vendor before inserting a row that could never receive telemetry.
	Describers map[models.Brand]adapters.SiteDescriber
	StartedAt  time.Time
}

func NewRouter(d *Deps) http.Handler {
	r := chi.NewRouter()
	// Request ID first so every downstream log line and response carries it.
	r.Use(observability.RequestIDMiddleware)
	r.Use(requestLogger(d.Metrics))
	r.Use(cors(d.Cfg.CORSAllowedOrigins))

	r.Get("/health", d.handleHealth)
	r.Get("/healthz", d.handleLiveness)

	// Metrics are deliberately not behind the API's JWT auth: a Prometheus
	// scraper has no session. Bind this to an internal interface or
	// restrict it at the reverse proxy — it exposes operational shape, not
	// telemetry or credentials.
	if d.Cfg.MetricsEnabled && d.Metrics != nil {
		r.Handle("/metrics", d.Metrics.Handler())
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", d.handleLogin)
		r.Post("/auth/refresh", d.handleRefresh)
		r.Post("/auth/logout", d.handleLogout)

		// SSE checks the token itself (query param fallback) because
		// browsers' native EventSource can't set an Authorization header.
		r.Get("/alerts/stream", d.withStreamAuth(d.handleAlertStream))

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(d.TokenIssuer))

			r.Get("/me", d.handleMe)
			r.Get("/fleet/summary", d.handleFleetSummary)
			// The wall display's day curve and the energy-vs-yesterday chip.
			r.Get("/fleet/today", d.handleFleetToday)

			r.Get("/sites", d.handleListSites)
			r.Get("/sites/{id}", d.handleGetSite)
			r.Get("/sites/{id}/history", d.handleSiteHistory)
			r.Get("/sites/{id}/alerts", d.handleSiteAlerts)

			r.Get("/alerts", d.handleListActiveAlerts)
			r.Get("/alerts/history", d.handleListAlertHistory)
			r.Post("/chat", d.handleChat)

			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(models.RoleAdmin, models.RoleTechnician))
				r.Post("/alerts/{id}/acknowledge", d.handleAcknowledgeAlert)
			})

			r.Route("/admin", func(r chi.Router) {
				r.Use(auth.RequireRole(models.RoleAdmin))
				r.Post("/sites", d.handleCreateSite)
				r.Patch("/sites/{id}", d.handleUpdateSite)
				r.Delete("/sites/{id}", d.handleDeleteSite)
				r.Get("/alert-settings", d.handleGetAlertSettings)
				r.Put("/alert-settings", d.handleUpdateAlertSettings)

				r.Get("/users", d.handleListUsers)
				r.Post("/users", d.handleCreateUser)
			})
		})
	})

	return r
}

// withStreamAuth accepts the access token either as a normal Authorization
// header or as ?token=... — EventSource in the browser can only do the
// latter, so both are supported for this one endpoint.
func (d *Deps) withStreamAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			writeError(w, http.StatusUnauthorized, "missing token")
			return
		}
		if _, err := d.TokenIssuer.ParseAccessToken(token); err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		next(w, r)
	}
}
