package observability

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

type ctxKey struct{}

// HeaderRequestID is both read and written, so a request ID assigned by an
// upstream proxy or by the frontend survives into our logs instead of being
// replaced by one nobody else has seen.
const HeaderRequestID = "X-Request-Id"

// RequestIDMiddleware attaches a correlation ID to every request, echoes it
// back in the response header, and puts it in the context for handlers and
// loggers.
//
// Without it, a user reporting "the dashboard threw an error at about half
// two" leaves you grepping by timestamp across every log line the process
// emitted. With it they can read the ID off the failed response.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(HeaderRequestID)
		if id == "" || len(id) > 128 {
			// Reject absurd client-supplied values rather than logging them:
			// this string ends up in log lines and response headers.
			id = newRequestID()
		}
		w.Header().Set(HeaderRequestID, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}

// RequestIDFrom returns the correlation ID for a request context, or "".
func RequestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

func newRequestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b[:])
}
