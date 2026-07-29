package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/observability"
)

// cors restricts cross-origin requests to the configured frontend origin
// only, per the brief's "CORS configured for frontend domain only" requirement.
func cors(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Vary: Origin — without it a shared cache (CDN, reverse
			// proxy) can serve one origin's CORS response to another.
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush makes statusRecorder satisfy http.Flusher by delegating to the
// wrapped ResponseWriter. Without this, embedding http.ResponseWriter
// only promotes the interface's own methods (Header/Write/WriteHeader) —
// not Flush — so the SSE handler's `w.(http.Flusher)` assertion would
// fail on every request once wrapped by this middleware.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// requestLogger emits one structured JSON log line per request and records
// handler latency.
//
// The request_id makes a user-reported failure traceable: without it,
// "the dashboard errored around half two" means grepping by timestamp
// across everything the process emitted.
//
// Latency is labelled by chi's *route pattern*, not the raw path. Using
// r.URL.Path would mint a distinct Prometheus series per site UUID, which
// is the standard way to melt a metrics backend.
func requestLogger(metrics *observability.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			elapsed := time.Since(start)
			route := r.URL.Path
			if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.RoutePattern() != "" {
				route = rctx.RoutePattern()
			}

			slog.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"route", route,
				"status", rec.status,
				"duration_ms", elapsed.Milliseconds(),
				"request_id", observability.RequestIDFrom(r.Context()),
			)
			if metrics != nil {
				metrics.ObserveHTTP(r.Method, route, rec.status, elapsed)
			}
		})
	}
}
