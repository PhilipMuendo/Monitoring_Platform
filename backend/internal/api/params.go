package api

import (
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// urlUUIDParam reads a path param that must be a UUID — every id-keyed
// resource in this API is one — and writes a 400 if it isn't shaped like
// one.
//
// Every id-keyed storage lookup casts this value straight into a
// "$1::uuid" SQL parameter. Without this check, Postgres rejecting a
// malformed cast produced a generic error indistinguishable from any
// other internal failure, so e.g. GET /api/v1/sites/foo surfaced as a 500
// instead of the 400 its actual problem — a malformed id, not a missing
// site — calls for.
func urlUUIDParam(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	v := chi.URLParam(r, name)
	if !uuidPattern.MatchString(v) {
		writeError(w, http.StatusBadRequest, "invalid "+name)
		return "", false
	}
	return v, true
}
