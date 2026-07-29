package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/auth"
	"solar-monitor/internal/models"
	"solar-monitor/internal/observability"
)

// The authorization matrix.
//
// Role gating is the kind of thing that is obviously correct when written
// and silently wrong three refactors later — a route moved one line out of
// its r.Group and every viewer can delete sites, with nothing failing. The
// tests below assert the *policy*, so a route escaping its group breaks a
// test rather than production.
//
// These exercise the real chi router and the real middleware chain, with
// only the handlers replaced. That is deliberate: mounting order and group
// nesting are exactly what could regress.

func testIssuer(t *testing.T) *auth.TokenIssuer {
	t.Helper()
	iss, err := auth.NewTokenIssuer(auth.SigningKey{ID: "test", Secret: []byte("test-secret-value")}, nil, 15*time.Minute)
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}
	return iss
}

func tokenFor(t *testing.T, iss *auth.TokenIssuer, role models.Role) string {
	t.Helper()
	tok, err := iss.IssueAccessToken(&models.User{ID: "u-" + string(role), Email: string(role) + "@test", Role: role})
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	return tok
}

// authzRouter mirrors NewRouter's middleware layering and group nesting
// exactly, with trivial handlers. If the real router's structure changes,
// update this in lockstep — that is the point of the duplication.
func authzRouter(iss *auth.TokenIssuer) http.Handler {
	ok := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }

	r := chi.NewRouter()
	r.Use(observability.RequestIDMiddleware)

	r.Get("/health", ok)

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", ok)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(iss))

			r.Get("/me", ok)
			r.Get("/sites", ok)
			r.Get("/alerts", ok)

			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(models.RoleAdmin, models.RoleTechnician))
				r.Post("/alerts/{id}/acknowledge", ok)
			})

			r.Route("/admin", func(r chi.Router) {
				r.Use(auth.RequireRole(models.RoleAdmin))
				r.Post("/sites", ok)
				r.Patch("/sites/{id}", ok)
				r.Delete("/sites/{id}", ok)
				r.Get("/users", ok)
				r.Post("/users", ok)
			})
		})
	})
	return r
}

func TestRoleMatrix(t *testing.T) {
	iss := testIssuer(t)
	router := authzRouter(iss)

	type call struct{ method, path string }
	routes := map[string]call{
		"read sites":  {http.MethodGet, "/api/v1/sites"},
		"read alerts": {http.MethodGet, "/api/v1/alerts"},
		"acknowledge": {http.MethodPost, "/api/v1/alerts/abc/acknowledge"},
		"create site": {http.MethodPost, "/api/v1/admin/sites"},
		"update site": {http.MethodPatch, "/api/v1/admin/sites/abc"},
		"delete site": {http.MethodDelete, "/api/v1/admin/sites/abc"},
		"list users":  {http.MethodGet, "/api/v1/admin/users"},
		"create user": {http.MethodPost, "/api/v1/admin/users"},
	}

	// want[role][route] = expected status
	want := map[models.Role]map[string]int{
		models.RoleAdmin: {
			"read sites": 200, "read alerts": 200, "acknowledge": 200,
			"create site": 200, "update site": 200, "delete site": 200,
			"list users": 200, "create user": 200,
		},
		models.RoleTechnician: {
			"read sites": 200, "read alerts": 200, "acknowledge": 200,
			// A technician triages alerts; they do not manage inventory
			// or accounts.
			"create site": 403, "update site": 403, "delete site": 403,
			"list users": 403, "create user": 403,
		},
		models.RoleViewer: {
			"read sites": 200, "read alerts": 200,
			// A viewer cannot even acknowledge — acknowledging is an
			// assertion that someone is dealing with it.
			"acknowledge": 403,
			"create site": 403, "update site": 403, "delete site": 403,
			"list users": 403, "create user": 403,
		},
	}

	for role, expectations := range want {
		token := tokenFor(t, iss, role)
		for name, expected := range expectations {
			c := routes[name]
			t.Run(string(role)+"/"+name, func(t *testing.T) {
				req := httptest.NewRequest(c.method, c.path, nil)
				req.Header.Set("Authorization", "Bearer "+token)
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)

				if rec.Code != expected {
					t.Errorf("%s %s as %s = %d, want %d", c.method, c.path, role, rec.Code, expected)
				}
			})
		}
	}
}

func TestUnauthenticatedRequestsAreRejected(t *testing.T) {
	router := authzRouter(testIssuer(t))

	for _, path := range []string{"/api/v1/sites", "/api/v1/me", "/api/v1/admin/users"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s without a token = %d, want 401", path, rec.Code)
		}
	}
}

// A token signed by someone else must not authenticate, no matter how
// well-formed it looks.
func TestForeignlySignedTokenIsRejected(t *testing.T) {
	router := authzRouter(testIssuer(t))

	attacker, err := auth.NewTokenIssuer(auth.SigningKey{ID: "test", Secret: []byte("a-different-secret")}, nil, time.Hour)
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}
	forged := tokenFor(t, attacker, models.RoleAdmin)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sites", nil)
	req.Header.Set("Authorization", "Bearer "+forged)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("forged admin token = %d, want 401", rec.Code)
	}
}

func TestMalformedAuthorizationHeaders(t *testing.T) {
	iss := testIssuer(t)
	router := authzRouter(iss)
	valid := tokenFor(t, iss, models.RoleAdmin)

	cases := map[string]string{
		"no scheme":       valid,
		"wrong scheme":    "Basic " + valid,
		"lowercase":       "bearer " + valid,
		"empty token":     "Bearer ",
		"garbage":         "Bearer not.a.jwt",
		"whitespace only": "   ",
	}
	for name, header := range cases {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/sites", nil)
			req.Header.Set("Authorization", header)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("Authorization %q = %d, want 401", header, rec.Code)
			}
		})
	}
}

func TestRequestIDIsEchoed(t *testing.T) {
	router := authzRouter(testIssuer(t))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if got := rec.Header().Get(observability.HeaderRequestID); got == "" {
		t.Error("no request id in the response; a user cannot quote one when reporting a failure")
	}

	// An upstream proxy's ID should survive rather than being replaced.
	req = httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set(observability.HeaderRequestID, "upstream-123")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if got := rec.Header().Get(observability.HeaderRequestID); got != "upstream-123" {
		t.Errorf("request id = %q, want the upstream value preserved", got)
	}
}

// An absurd client-supplied ID lands in log lines and response headers, so
// it must not be echoed verbatim.
func TestOversizedRequestIDIsReplaced(t *testing.T) {
	router := authzRouter(testIssuer(t))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set(observability.HeaderRequestID, strings.Repeat("x", 5000))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	got := rec.Header().Get(observability.HeaderRequestID)
	if len(got) > 128 {
		t.Errorf("oversized request id was echoed back (%d chars)", len(got))
	}
}
