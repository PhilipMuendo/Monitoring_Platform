package api

import (
	"encoding/json"
	"testing"

	"solar-monitor/internal/models"
)

// Gemini's functionResponse.response is a protobuf Struct, so it MUST marshal
// to a JSON object. A bare array is rejected with HTTP 400 and takes the whole
// request down — which is what broke every question about a named site, since
// those reach get_site_alerts.
func TestToolResponseAlwaysMarshalsToAnObject(t *testing.T) {
	cases := map[string]any{
		"slice of structs": []models.Alert{{ID: "a"}, {ID: "b"}},
		"empty slice":      []models.Alert{},
		"nil typed slice":  []models.Alert(nil),
		"slice of maps":    []map[string]any{{"x": 1}},
		"map":              map[string]any{"ok": true},
		"struct":           models.Alert{ID: "a"},
		"nil":              nil,
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			raw, err := json.Marshal(toolResponseObject(in))
			if err != nil {
				t.Fatal(err)
			}
			if len(raw) == 0 || raw[0] != '{' {
				t.Errorf("marshals to %s — must be a JSON object, or Gemini rejects the request", raw)
			}
		})
	}
}

// The count spares the model counting a list, which it does badly.
func TestToolResponseWrapsListsWithACount(t *testing.T) {
	got := toolResponseObject([]models.Alert{{ID: "a"}, {ID: "b"}})
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("got %T, want a map", got)
	}
	if m["count"] != 2 {
		t.Errorf("count = %v, want 2", m["count"])
	}
	if _, ok := m["items"]; !ok {
		t.Error("wrapped list must keep the values under \"items\"")
	}
}

// A []byte marshals to a base64 STRING, not a list, so it is already legal —
// wrapping it would corrupt the shape for no reason.
func TestToolResponseLeavesBytesAlone(t *testing.T) {
	in := []byte("hello")
	if _, wrapped := toolResponseObject(in).(map[string]any); wrapped {
		t.Error("[]byte must not be wrapped: it is a string on the wire, not a list")
	}
}

// Objects must pass through untouched — wrapping them would bury every field
// one level deeper than the tool declared.
func TestToolResponsePassesObjectsThrough(t *testing.T) {
	in := map[string]any{"matched": 1}
	out, ok := toolResponseObject(in).(map[string]any)
	if !ok || out["matched"] != 1 {
		t.Errorf("object was altered: %#v", toolResponseObject(in))
	}
	if _, wrapped := out["items"]; wrapped {
		t.Error("object must not be wrapped in items/count")
	}
}
