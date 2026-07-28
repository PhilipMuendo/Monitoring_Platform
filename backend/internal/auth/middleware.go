package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"solar-monitor/internal/models"
)

type contextKey string

const userContextKey contextKey = "authed_user"

type AuthedUser struct {
	ID    string
	Email string
	Role  models.Role
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// Middleware validates the Bearer access token on every protected route
// and injects the resolved user (id/email/role) into the request context.
func Middleware(issuer *TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				writeJSONError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			tokenString := strings.TrimPrefix(header, "Bearer ")
			claims, err := issuer.ParseAccessToken(tokenString)
			if err != nil {
				writeJSONError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, AuthedUser{
				ID:    claims.Subject,
				Email: claims.Email,
				Role:  claims.Role,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserFromContext(ctx context.Context) (AuthedUser, bool) {
	u, ok := ctx.Value(userContextKey).(AuthedUser)
	return u, ok
}

// RequireRole gates a route to specific roles. Must run after Middleware.
func RequireRole(roles ...models.Role) func(http.Handler) http.Handler {
	allowed := make(map[models.Role]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := UserFromContext(r.Context())
			if !ok || !allowed[u.Role] {
				writeJSONError(w, http.StatusForbidden, "insufficient permissions for this action")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
