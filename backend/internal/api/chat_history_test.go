package api

import (
	"errors"
	"strings"
	"testing"
)

// Regression guard. A single transient 503 used to brick a whole conversation:
// the browser recorded an empty assistant turn, and Gemini rejects an empty
// part with HTTP 400, so every later message failed with an error that looked
// nothing like the cause.
func TestHistoryToContentsDropsEmptyTurns(t *testing.T) {
	got := historyToContents([]chatMessage{
		{Role: "user", Text: "how many sites are offline?"},
		{Role: "model", Text: ""},    // the failed turn
		{Role: "model", Text: "   "}, // whitespace is just as empty to Gemini
		{Role: "user", Text: "and which brands?"},
	})

	if len(got) != 2 {
		t.Fatalf("got %d contents, want 2 — empty turns must be dropped: %+v", len(got), got)
	}
	for i, c := range got {
		if strings.TrimSpace(c.Parts[0].Text) == "" {
			t.Errorf("contents[%d] has an empty part, which Gemini rejects outright", i)
		}
	}
}

func TestHistoryToContentsMapsRoles(t *testing.T) {
	got := historyToContents([]chatMessage{
		{Role: "user", Text: "a"},
		{Role: "assistant", Text: "b"}, // alias for "model"
		{Role: "model", Text: "c"},
	})
	want := []string{"user", "model", "model"}
	for i, w := range want {
		if got[i].Role != w {
			t.Errorf("contents[%d].Role = %q, want %q", i, got[i].Role, w)
		}
	}
}

func TestHistoryToContentsCapsLength(t *testing.T) {
	long := make([]chatMessage, chatMaxHistory+10)
	for i := range long {
		long[i] = chatMessage{Role: "user", Text: "x"}
	}
	if got := len(historyToContents(long)); got != chatMaxHistory {
		t.Errorf("got %d contents, want the history capped at %d", got, chatMaxHistory)
	}
}

// The whole point of the split: "press send again" must not read the same as
// "an engineer needs to fix the config".
func TestChatErrorMessage(t *testing.T) {
	cases := map[string]string{
		"/models/x:generateContent: HTTP 503: high demand": "busy",
		`{"status":"UNAVAILABLE"}`:                         "busy",
		"HTTP 429: quota":                                  "rate limit",
		`{"status":"RESOURCE_EXHAUSTED"}`:                  "rate limit",
		"HTTP 404: model not found":                        "unavailable",
		"dial tcp: connection refused":                     "unavailable",
	}
	for in, want := range cases {
		if got := chatErrorMessage(errors.New(in)); !strings.Contains(got, want) {
			t.Errorf("chatErrorMessage(%q) = %q, want it to mention %q", in, got, want)
		}
	}
}
