// Package api wires the HTTP surface: chi router, request/response
// handling, auth middleware, and the SSE alert stream. Deps holds every
// repository/service a handler might need; handlers are methods on *Deps
// so they read like a cohesive controller layer without a DI framework.
package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/auth"
	"solar-monitor/internal/collector"
	"solar-monitor/internal/config"
	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

type Deps struct {
	Cfg         *config.Config
	Sites       *storage.SiteRepo
	Metrics     *storage.MetricsRepo
	Alerts      *storage.AlertRepo
	Users       *storage.UserRepo
	Audit       *storage.AuditRepo
	AuthService *auth.Service
	TokenIssuer *auth.TokenIssuer
	Collector   *collector.Collector
	SSEHub      *SSEHub
	StartedAt   time.Time
}

func NewRouter(d *Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(requestLogger)
	r.Use(cors(d.Cfg.CORSAllowedOrigin))

	r.Get("/health", d.handleHealth)
	r.Get("/healthz", d.handleLiveness)

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

			r.Get("/sites", d.handleListSites)
			r.Get("/sites/{id}", d.handleGetSite)
			r.Get("/sites/{id}/history", d.handleSiteHistory)
			r.Get("/sites/{id}/alerts", d.handleSiteAlerts)

			r.Get("/alerts", d.handleListActiveAlerts)

			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(models.RoleAdmin, models.RoleTechnician))
				r.Post("/alerts/{id}/acknowledge", d.handleAcknowledgeAlert)
			})

			r.Route("/admin", func(r chi.Router) {
				r.Use(auth.RequireRole(models.RoleAdmin))
				r.Post("/sites", d.handleCreateSite)
				r.Patch("/sites/{id}", d.handleUpdateSite)
				r.Delete("/sites/{id}", d.handleDeleteSite)
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
