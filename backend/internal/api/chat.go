package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strings"
	"time"

	"solar-monitor/internal/adapters/gemini"
	"solar-monitor/internal/auth"
	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

// chatMaxHistory bounds how much prior conversation is replayed to Gemini
// on every turn — the client holds the full transcript, but only the tail
// is sent, so a long-running chat doesn't grow the prompt (and the bill)
// without bound.
const chatMaxHistory = 20

// chatMaxToolHops bounds the read-tool-call -> response -> re-generate
// loop. A well-behaved answer needs at most a couple of tool calls; this
// exists purely as a circuit breaker against a model that keeps calling
// tools instead of answering.
const chatMaxToolHops = 4

const (
	chatRateMax    = 10
	chatRateWindow = time.Minute
)

const chatSystemPrompt = `You are the assistant embedded in a solar fleet monitoring dashboard. ` +
	`You answer operators' questions about their fleet — site status, power/energy history, alerts, and the ` +
	`health of the monitoring platform itself — using only the tools provided. Never invent numbers or site ` +
	`names; if a tool call fails or a site isn't found, say so plainly. Keep answers short and concrete ` +
	`(numbers, site names, timestamps) rather than generic. ` +
	`Call tools rather than guessing. ` +
	`FOR A QUESTION ABOUT A NAMED SITE, call find_site with part of the name — that resolves the name to the ` +
	`site_id the other site tools need, and already returns that site's current telemetry, so a simple status ` +
	`question needs nothing else. Use get_site_history for questions about trends or a period ("this week", ` +
	`"yesterday", "is it getting worse"), and get_site_alerts for what has gone wrong there. Do NOT page ` +
	`through list_sites hunting for a name: it is capped and a large fleet will not fit, so a site you cannot ` +
	`see is not the same as a site that does not exist. ` +
	`If find_site returns several matches, answer about all of them briefly or ask which one — never silently ` +
	`pick one. If it returns none, say the fleet has no site matching that name rather than inventing figures. ` +
	`Combine tools freely for questions that need more than one — comparing sites, or ranking them by ` +
	`production, means listing sites and reading the figures rather than asking the user to narrow it down. ` +
	`Distinguish a site being down from the platform failing to reach it: sites reported as "unknown" mean we ` +
	`could not read them, not that they stopped generating. If a whole brand is unknown, call get_system_health ` +
	`— that is a collection problem on our side, not a fleet outage. ` +
	`Telemetry fields are nullable and null means "the inverter did not report this", never zero; say "not ` +
	`reported" rather than reporting a 0. ` +
	`If asked to acknowledge an alert, call the acknowledge_alert tool; if that tool isn't available to you or ` +
	`it reports a permissions error, tell the user they don't have permission to do that here.`

type chatMessage struct {
	Role string `json:"role"` // "user" or "model"
	Text string `json:"text"`
}

type chatRequest struct {
	Message string        `json:"message"`
	History []chatMessage `json:"history"`
}

var chatReadTools = []gemini.FunctionDeclaration{
	{
		Name:        "get_fleet_summary",
		Description: "Aggregate fleet KPIs: sites online/offline/unknown and the active alert count.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
	},
	{
		Name:        "list_sites",
		Description: "List sites with their latest status. Problem sites (offline or alerting) are sorted first.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"all":{"type":"boolean","description":"include inactive sites, default false"}}}`),
	},
	{
		Name: "find_site",
		Description: "Find sites by name or location, case-insensitive partial match. " +
			"USE THIS FIRST for any question about a named site — it is how you turn a name " +
			"the user typed into the site_id that get_site, get_site_history and get_site_alerts need. " +
			"Returns the matching sites with their ids and current telemetry, so for a simple " +
			"'how is X doing' this is often the only call you need. " +
			"If it returns nothing, the site is not in the fleet under that name — say so and " +
			"offer list_sites; do not guess an id.",
		Parameters: json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"part of the site name or location, e.g. \"kitale\""},"all":{"type":"boolean","description":"include inactive sites, default false"}},"required":["query"]}`),
	},
	{
		Name:        "get_site",
		Description: "Get one site's details and latest telemetry by its id. Resolve a NAME to an id with find_site first.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"site_id":{"type":"string"}},"required":["site_id"]}`),
	},
	{
		Name:        "get_site_history",
		Description: "Get a site's power-curve history for a time range.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"site_id":{"type":"string"},"range":{"type":"string","enum":["24h","7d","30d"]}},"required":["site_id"]}`),
	},
	{
		Name:        "get_site_alerts",
		Description: "Get alert history for one site.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"site_id":{"type":"string"}},"required":["site_id"]}`),
	},
	{
		Name:        "list_active_alerts",
		Description: "List every currently unresolved alert across the fleet, most severe and most recent first.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{}}`),
	},
	{
		Name: "get_system_health",
		Description: "Health of the monitoring platform ITSELF, as opposed to the solar sites: " +
			"whether the last collection cycle succeeded, how long ago it ran, its duration and error count, " +
			"and a per-brand breakdown of how many sites came back online, offline or unreachable. " +
			"Use this for questions about whether data is current or why a whole brand's sites show as unknown — " +
			"a brand with every site unreachable means the platform cannot reach that vendor's API, " +
			"which is a very different problem from those sites being down.",
		Parameters: json.RawMessage(`{"type":"object","properties":{}}`),
	},
}

var chatAcknowledgeTool = gemini.FunctionDeclaration{
	Name:        "acknowledge_alert",
	Description: "Acknowledge and close an alert by id. Only permitted for admin/technician users.",
	Parameters:  json.RawMessage(`{"type":"object","properties":{"alert_id":{"type":"string"}},"required":["alert_id"]}`),
}

// handleChat is POST /api/v1/chat. It streams its reply over SSE (one
// event per model turn, not per token — see the gemini package doc
// comment for why) so the widget can render progressively instead of
// waiting for the whole tool-calling loop to finish.
func (d *Deps) handleChat(w http.ResponseWriter, r *http.Request) {
	if d.Gemini == nil {
		writeError(w, http.StatusServiceUnavailable, "chat is not configured")
		return
	}
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if d.ChatLimiter != nil && !d.ChatLimiter.Allow(u.ID, chatRateMax, chatRateWindow) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded, try again shortly")
		return
	}

	var req chatRequest
	if err := decodeJSON(r, &req); err != nil || req.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Access-Control-Allow-Origin is already set correctly (matched
	// against this request's actual Origin) by the cors() middleware
	// earlier in the chain — overwriting it here with a static value
	// would break multi-origin support for this one route.
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	tools := chatReadTools
	if u.Role != models.RoleViewer {
		tools = append(append([]gemini.FunctionDeclaration{}, chatReadTools...), chatAcknowledgeTool)
	}

	contents := historyToContents(req.History)
	contents = append(contents, gemini.Content{Role: "user", Parts: []gemini.Part{{Text: req.Message}}})

	ctx := r.Context()
	for range chatMaxToolHops {
		result, err := d.Gemini.Generate(ctx, chatSystemPrompt, contents, tools)
		if err != nil {
			// Log the cause. This previously discarded err entirely, so a
			// misconfigured model produced "the assistant is unavailable right
			// now" in the widget and NOTHING server-side — the endpoint even
			// logs status 200, because SSE headers are written before the
			// first model call. That combination is close to undiagnosable:
			// it cost a real debugging session when the default model
			// (gemini-1.5-flash) was retired by Google and every request began
			// 404ing. The model name is included because it is the field most
			// likely to be wrong.
			slog.Error("chat generation failed",
				"error", err, "model", d.Cfg.GeminiModel, "user_id", u.ID)
			writeSSE(w, flusher, "error", map[string]string{"error": chatErrorMessage(err)})
			return
		}

		if result.Text != "" {
			writeSSE(w, flusher, "token", map[string]string{"text": result.Text})
		}

		if len(result.FunctionCalls) == 0 {
			writeSSE(w, flusher, "done", map[string]string{})
			return
		}

		contents = append(contents, gemini.Content{Role: "model", Parts: turnParts(result)})

		responseParts := make([]gemini.Part, 0, len(result.FunctionCalls))
		for _, fc := range result.FunctionCalls {
			res := d.dispatchChatTool(ctx, u, fc)
			if res.acknowledged != nil {
				writeSSE(w, flusher, "tool_result", map[string]any{"tool": fc.Name, "alert": res.acknowledged})
			}
			responseParts = append(responseParts, gemini.Part{
				FunctionResponse: &gemini.FunctionResponse{Name: fc.Name, Response: toolResponseObject(res.response)},
			})
		}
		contents = append(contents, gemini.Content{Role: "user", Parts: responseParts})
	}

	writeSSE(w, flusher, "error", map[string]string{"error": "the assistant took too many steps to answer that"})
}

type chatToolResult struct {
	response any
	// acknowledged is set only by a successful acknowledge_alert call, so
	// the handler can push a dedicated tool_result event the frontend uses
	// to invalidate its alert query cache.
	acknowledged *models.Alert
}

// dispatchChatTool executes one Gemini function call against the same
// repositories the equivalent HTTP handlers use (handleFleetSummary,
// handleListSites, handleGetSite, handleSiteHistory, handleSiteAlerts,
// handleListActiveAlerts, handleAcknowledgeAlert) — the chat surface reuses
// application logic rather than looping back through HTTP.
func (d *Deps) dispatchChatTool(ctx context.Context, u auth.AuthedUser, fc gemini.FunctionCall) chatToolResult {
	var args map[string]any
	_ = json.Unmarshal(fc.Args, &args)
	argStr := func(key string) string {
		s, _ := args[key].(string)
		return s
	}

	switch fc.Name {
	case "get_fleet_summary":
		summary, err := d.Sites.FleetSummary(ctx)
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		activeAlerts, _ := d.Alerts.CountActive(ctx)
		summary.ActiveAlerts = activeAlerts
		return chatToolResult{response: summary}

	case "get_system_health":
		// Deliberately reports the PLATFORM's health, not the fleet's. "Every
		// Sosen site is unknown" and "every Sosen site is offline" look alike
		// in a site list but mean opposite things: the first is our own
		// collection failing, the second is the sites failing. Handing the
		// model the per-brand split plus the cycle's error count lets it tell
		// the two apart instead of guessing from status counts.
		if d.Collector == nil {
			return chatToolResult{response: toolError(fmt.Errorf("collector not running"))}
		}
		stats := d.Collector.Stats()
		lastRun := d.Collector.LastRun()
		health := map[string]any{
			"last_cycle_started_at":  lastRun,
			"last_cycle_duration_ms": stats.DurationMS,
			"sites_polled":           stats.SitesPolled,
			"errors_last_cycle":      stats.Errors,
			"poll_interval":          d.Cfg.PollInterval.String(),
			"brands":                 stats.ByBrand,
		}
		if !lastRun.IsZero() {
			health["seconds_since_last_cycle"] = int(time.Since(lastRun).Seconds())
		}
		if dbErr := d.DB.Pool.Ping(ctx); dbErr != nil {
			health["database_ok"] = false
			health["database_error"] = dbErr.Error()
		} else {
			health["database_ok"] = true
		}
		return chatToolResult{response: health}

	case "list_sites":
		all, _ := args["all"].(bool)
		page, err := d.Sites.List(ctx, storage.ListParams{ActiveOnly: !all})
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		return chatToolResult{response: page}

	case "find_site":
		q := strings.TrimSpace(argStr("query"))
		if q == "" {
			return chatToolResult{response: map[string]string{"error": "query is required"}}
		}
		all, _ := args["all"].(bool)
		matches, err := d.Sites.SearchByName(ctx, q, !all)
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		// Returned as a named object rather than a bare list so "no such site"
		// is unambiguous. An empty array reads to the model as an unhelpful
		// tool result it might retry or work around; matched:0 alongside the
		// query it searched for is a fact it can report.
		return chatToolResult{response: map[string]any{
			"query":   q,
			"matched": len(matches),
			"sites":   matches,
		}}

	case "get_site":
		site, err := d.Sites.GetByID(ctx, argStr("site_id"))
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		return chatToolResult{response: site}

	case "get_site_history":
		siteID := argStr("site_id")
		rng := argStr("range")
		if rng == "" {
			rng = "24h"
		}
		var (
			points any
			err    error
		)
		switch rng {
		case "7d":
			points, err = d.SiteMetrics.HistoryHourly(ctx, siteID, 7*24*time.Hour)
		case "30d":
			points, err = d.SiteMetrics.HistoryHourly(ctx, siteID, 30*24*time.Hour)
		default:
			points, err = d.SiteMetrics.History24h(ctx, siteID)
		}
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		return chatToolResult{response: map[string]any{"range": rng, "points": points}}

	case "get_site_alerts":
		alerts, err := d.Alerts.ListForSite(ctx, argStr("site_id"), 50)
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		return chatToolResult{response: alerts}

	case "list_active_alerts":
		alerts, err := d.Alerts.ListActive(ctx)
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		return chatToolResult{response: alerts}

	case "acknowledge_alert":
		// Re-checked here regardless of whether the tool was offered to
		// Gemini for this role — the model must never be trusted as the
		// only enforcement point for a mutating action.
		if u.Role != models.RoleAdmin && u.Role != models.RoleTechnician {
			return chatToolResult{response: map[string]string{"error": "forbidden: your role cannot acknowledge alerts"}}
		}
		alert, err := d.acknowledgeAlert(ctx, argStr("alert_id"), u.ID, "chat")
		if err != nil {
			return chatToolResult{response: toolError(err)}
		}
		return chatToolResult{response: alert, acknowledged: &alert}

	default:
		return chatToolResult{response: map[string]string{"error": "unknown tool"}}
	}
}

func toolError(err error) map[string]string {
	return map[string]string{"error": err.Error()}
}

// toolResponseObject makes a tool's return value legal as a functionResponse.
//
// Gemini's functionResponse.response is a protobuf Struct, which means it must
// be a JSON OBJECT. Hand it an array and the whole request is rejected:
//
//	HTTP 400 Unknown name "response" at 'contents[6].parts[0].function_response':
//	Proto field is not repeating, cannot start list.
//
// list_active_alerts and get_site_alerts both returned bare slices, so any
// question that reached either one killed the conversation — and because those
// are exactly the tools a question about ONE SITE tends to reach ("how is
// Sanana hotel doing?" -> list_sites -> get_site -> get_site_alerts), site
// questions failed while fleet-level questions worked. The error surfaced as
// the generic "assistant is unavailable", which pointed nowhere near the cause.
//
// Applied HERE, at the single point where every function response is built,
// rather than by fixing the two offending tools. A per-tool fix leaves the
// same trap set for the next tool that returns a list, and this is not a
// mistake a reviewer would catch — the Go compiles, the JSON is valid, and it
// only fails once the model happens to call that tool.
//
// The count is not just padding to satisfy the type: it saves the model
// counting a list to answer "how many", which it does badly.
func toolResponseObject(v any) any {
	rv := reflect.ValueOf(v)
	if !rv.IsValid() {
		return map[string]any{}
	}
	if k := rv.Kind(); k == reflect.Slice || k == reflect.Array {
		// []byte marshals to a base64 string, not a list, so it is already
		// legal and must not be wrapped.
		if rv.Type().Elem().Kind() == reflect.Uint8 {
			return v
		}
		return map[string]any{"items": v, "count": rv.Len()}
	}
	return v
}

// turnParts converts one Gemini Result back into the Parts of the "model"
// turn to append to the conversation, so the next Generate call sees
// exactly what the model said and asked for.
func turnParts(result gemini.Result) []gemini.Part {
	// Replay the model's parts verbatim. Rebuilding them from Text and
	// FunctionCalls looked equivalent but dropped every per-part field the
	// gemini package does not model — including ThoughtSignature, which the
	// API requires back on functionCall parts and rejects the entire request
	// without ("Function call is missing a thought_signature"). Rebuilding
	// therefore broke tool calling outright on models that emit it.
	if len(result.Parts) > 0 {
		return result.Parts
	}

	// Fallback for a turn with no raw parts (only reachable if a future
	// caller constructs a Result by hand).
	parts := make([]gemini.Part, 0, len(result.FunctionCalls)+1)
	if result.Text != "" {
		parts = append(parts, gemini.Part{Text: result.Text})
	}
	for _, fc := range result.FunctionCalls {
		parts = append(parts, gemini.Part{FunctionCall: &fc})
	}
	return parts
}

// chatErrorMessage turns an upstream failure into something the operator can
// act on.
//
// Every failure used to render as "the assistant is unavailable right now".
// That single sentence covered a retired model id, a missing API key, and a
// thirty-second capacity blip — three problems with completely different
// responses ("fix the config", "add the key", "press send again"). It is worth
// separating the one the user can resolve themselves in five seconds from the
// two that need an engineer, because the ambiguity is what sends people
// looking for a bug that is not there.
//
// Matched on the response body rather than a typed error: the adapter wraps
// the upstream status into the error string, and introducing a typed error
// hierarchy through httpjson for two cases is more machinery than the problem
// deserves. Kept to the two statuses Google actually returns for load.
func chatErrorMessage(err error) string {
	s := err.Error()
	switch {
	case strings.Contains(s, "HTTP 503"), strings.Contains(s, "UNAVAILABLE"):
		return "the assistant is busy right now — try that again in a moment"
	case strings.Contains(s, "HTTP 429"), strings.Contains(s, "RESOURCE_EXHAUSTED"):
		return "the assistant has hit its rate limit — try again shortly"
	default:
		return "the assistant is unavailable right now"
	}
}

func historyToContents(history []chatMessage) []gemini.Content {
	if len(history) > chatMaxHistory {
		history = history[len(history)-chatMaxHistory:]
	}
	out := make([]gemini.Content, 0, len(history))
	for _, m := range history {
		// Drop empty turns. Gemini rejects a part with no content outright —
		// `contents[i].parts[0].data: required oneof field 'data' must have
		// one initialized field`, HTTP 400 — which takes down the whole
		// request, not just that turn.
		//
		// This has bitten once already, and the shape of the failure is what
		// makes it worth guarding here rather than only at the client: the
		// browser recorded an empty assistant turn after a request failed, so
		// ONE transient upstream error (a 503 capacity spike) permanently
		// bricked that conversation — every subsequent message failed with a
		// 400 that looked nothing like the original problem. The client no
		// longer creates that state, but history arrives over the wire from
		// something we do not control, so it is filtered on arrival too.
		if strings.TrimSpace(m.Text) == "" {
			continue
		}
		role := "user"
		if m.Role == "model" || m.Role == "assistant" {
			role = "model"
		}
		out = append(out, gemini.Content{Role: role, Parts: []gemini.Part{{Text: m.Text}}})
	}
	return out
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, event string, data any) {
	payload, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
	flusher.Flush()
}
