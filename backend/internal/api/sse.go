package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type SSEEvent struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// SSEHub fans out alert events to every connected wall-display/dashboard
// client, so a new problem appears immediately instead of waiting for
// the next 5-minute poll. Satisfies alertengine.Notifier via Publish.
type SSEHub struct {
	mu      sync.Mutex
	clients map[chan SSEEvent]struct{}
}

func NewSSEHub() *SSEHub {
	return &SSEHub{clients: make(map[chan SSEEvent]struct{})}
}

// Publish implements alertengine.Notifier.
func (h *SSEHub) Publish(eventType string, data any) {
	h.broadcast(SSEEvent{Type: eventType, Data: data})
}

func (h *SSEHub) broadcast(evt SSEEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- evt:
		default: // slow/stalled client — drop rather than block the whole hub
		}
	}
}

func (h *SSEHub) subscribe() chan SSEEvent {
	ch := make(chan SSEEvent, 8)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *SSEHub) unsubscribe(ch chan SSEEvent) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

// handleAlertStream is GET /api/v1/alerts/stream — a long-lived
// Server-Sent Events connection pushing "alert.created", "alert.resolved"
// and "alert.acknowledged" events as they happen.
func (d *Deps) handleAlertStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", d.Cfg.CORSAllowedOrigin)

	ch := d.SSEHub.subscribe()
	defer d.SSEHub.unsubscribe(ch)

	fmt.Fprint(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	keepAlive := time.NewTicker(25 * time.Second)
	defer keepAlive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			payload, _ := json.Marshal(evt.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, payload)
			flusher.Flush()
		case <-keepAlive.C:
			fmt.Fprint(w, ": keep-alive\n\n")
			flusher.Flush()
		}
	}
}
