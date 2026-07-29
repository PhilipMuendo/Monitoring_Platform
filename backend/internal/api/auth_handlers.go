package api

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"solar-monitor/internal/auth"
)

// refreshCookieName holds the refresh token.
//
// It moved out of the JSON body (and therefore out of the frontend's
// localStorage) because a refresh token is a 30-day credential: any XSS
// anywhere on the origin could read it from localStorage and hold a
// month-long session. In an HttpOnly cookie, script cannot read it at all.
//
// The access token stays in the response body deliberately — it is short
// lived and the SPA keeps it in memory only. Sending it as an Authorization
// header rather than a cookie is also what keeps the authenticated API
// routes immune to CSRF.
const refreshCookieName = "solar_refresh"

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// refreshRequest remains for clients that cannot use cookies (the wall
// display may run cross-origin). The cookie takes precedence when present.
type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func authPayload(res *auth.Result) map[string]any {
	return map[string]any{
		"access_token": res.AccessToken,
		"user": map[string]any{
			"id":    res.User.ID,
			"email": res.User.Email,
			"name":  res.User.Name,
			"role":  res.User.Role,
		},
	}
}

// setRefreshCookie writes the refresh token as an HttpOnly cookie.
//
// SameSite=Lax rather than Strict: Strict drops the cookie on a top-level
// navigation into the app (following a link from an alert email), which
// silently logs the user out. Lax still blocks cross-site sub-requests,
// which is the CSRF case that matters here.
func (d *Deps) setRefreshCookie(w http.ResponseWriter, token string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   d.Cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ttl.Seconds()),
	})
}

func (d *Deps) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   d.Cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// refreshTokenFrom prefers the cookie, falling back to the JSON body.
func refreshTokenFrom(r *http.Request, body refreshRequest) string {
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		return c.Value
	}
	return body.RefreshToken
}

func (d *Deps) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Throttle keyed on account *and* client IP, checked before Login so
	// bcrypt never runs for a locked-out key. That ordering is the CPU
	// exhaustion defence, not merely the password-guessing defence.
	key := throttleKey(r, req.Email)
	if allowed, retryAfter := d.LoginThrottle.Allowed(key); !allowed {
		d.Metrics.ObserveLogin("throttled")
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "too many failed attempts; try again later")
		return
	}

	res, err := d.AuthService.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			d.LoginThrottle.RecordFailure(key)
			d.Metrics.ObserveLogin("invalid_credentials")
			writeError(w, http.StatusUnauthorized, "invalid email or password")
		case errors.Is(err, auth.ErrAccountDisabled):
			// Not counted as a failure: the credentials may well be
			// correct, and locking the key out achieves nothing.
			d.Metrics.ObserveLogin("disabled")
			writeError(w, http.StatusForbidden, "account disabled")
		default:
			d.Metrics.ObserveLogin("error")
			writeError(w, http.StatusInternalServerError, "login failed")
		}
		return
	}

	d.LoginThrottle.RecordSuccess(key)
	d.Metrics.ObserveLogin("success")
	d.setRefreshCookie(w, res.RefreshToken, d.Cfg.JWTRefreshTTL)
	writeJSON(w, http.StatusOK, authPayload(res))
}

func (d *Deps) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var body refreshRequest
	// A cookie-only client sends no body at all, so a decode failure here
	// is not fatal.
	_ = decodeJSON(r, &body)

	token := refreshTokenFrom(r, body)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing refresh token")
		return
	}

	res, err := d.AuthService.Refresh(r.Context(), token)
	if err != nil {
		d.clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "invalid or expired refresh token")
		return
	}

	// Refresh rotates the token, so the cookie must be reissued.
	d.setRefreshCookie(w, res.RefreshToken, d.Cfg.JWTRefreshTTL)
	writeJSON(w, http.StatusOK, authPayload(res))
}

func (d *Deps) handleLogout(w http.ResponseWriter, r *http.Request) {
	var body refreshRequest
	_ = decodeJSON(r, &body)

	if token := refreshTokenFrom(r, body); token != "" {
		_ = d.AuthService.Logout(r.Context(), token)
	}
	d.clearRefreshCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d *Deps) handleMe(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": u.ID, "email": u.Email, "role": u.Role})
}

// throttleKey combines the normalised account identifier with the client
// IP. Either alone is insufficient: per-account only lets a botnet spray
// one password across every account; per-IP only lets an attacker behind a
// large NAT lock out everyone sharing it.
func throttleKey(r *http.Request, email string) string {
	return strings.ToLower(strings.TrimSpace(email)) + "|" + clientIP(r)
}

// clientIP prefers the left-most X-Forwarded-For entry, since the
// documented deployment puts this behind a reverse proxy.
//
// The header is client-controllable when the app is exposed directly. That
// is acceptable here: forging it can only split an attacker's own throttle
// bucket, never bypass the per-account half of the key, which is the part
// that actually protects a user's account.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
