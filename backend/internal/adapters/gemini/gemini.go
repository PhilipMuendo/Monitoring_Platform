// Package gemini is a minimal client for Google's Gemini API, covering only
// what the chat feature needs: single-turn generation with function
// calling. It sits on the shared httpjson transport (retries, timeouts,
// error classification) like every other outbound integration in this
// codebase, rather than pulling in the full Google GenAI SDK for one
// endpoint.
//
// Deliberately non-streaming at the HTTP layer: Gemini's REST API also
// offers streamGenerateContent (chunked SSE), but that would mean either
// bypassing httpjson's retry/backoff handling (which assumes a single
// decodable response) or duplicating it for one caller. A non-streaming
// generateContent call still lets the chat handler stream its own
// SSE response to the browser one turn at a time — the perceived latency
// difference is one round trip per tool-calling hop, not per token.
package gemini

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"solar-monitor/internal/adapters/httpjson"
)

const baseURL = "https://generativelanguage.googleapis.com/v1beta/models"

type Client struct {
	http   *httpjson.Client
	apiKey string
	model  string
}

func New(apiKey, model string, hooks httpjson.Hooks) *Client {
	return &Client{
		http:   httpjson.New("gemini", httpjson.Defaults(), hooks),
		apiKey: apiKey,
		model:  model,
	}
}

// Part is a single piece of a Content turn: text, a model-issued function
// call, or the caller's response to one. Gemini's wire format allows all
// three fields on one Part but callers of this package only ever set one.
type Part struct {
	Text             string            `json:"text,omitempty"`
	FunctionCall     *FunctionCall     `json:"functionCall,omitempty"`
	FunctionResponse *FunctionResponse `json:"functionResponse,omitempty"`
	// ThoughtSignature is an opaque token Gemini attaches to a functionCall
	// part. It MUST be echoed back unchanged when that turn is replayed in a
	// later request, or the API rejects the whole call with HTTP 400
	// "Function call is missing a thought_signature in functionCall parts".
	//
	// We never read it — it is carried, not interpreted. Dropping it is easy
	// to do by accident, because reconstructing the model's turn from parsed
	// fields loses anything not modelled here; see Result.Parts.
	ThoughtSignature string `json:"thoughtSignature,omitempty"`
}

type FunctionCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args,omitempty"`
}

type FunctionResponse struct {
	Name     string `json:"name"`
	Response any    `json:"response"`
}

// Content is one turn of the conversation. Role is "user" or "model";
// tool results are sent back as role "user" per Gemini's convention.
type Content struct {
	Role  string `json:"role,omitempty"`
	Parts []Part `json:"parts"`
}

// FunctionDeclaration describes one callable tool. Parameters is a JSON
// Schema object, passed through verbatim.
type FunctionDeclaration struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

type toolSet struct {
	FunctionDeclarations []FunctionDeclaration `json:"functionDeclarations"`
}

type generateRequest struct {
	SystemInstruction *Content  `json:"system_instruction,omitempty"`
	Contents          []Content `json:"contents"`
	Tools             []toolSet `json:"tools,omitempty"`
}

type generateResponse struct {
	Candidates []struct {
		Content      Content `json:"content"`
		FinishReason string  `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
}

// Result is one model turn: any text it produced, plus any function calls
// it wants executed before it will continue.
type Result struct {
	Text          string
	FunctionCalls []FunctionCall
	FinishReason  string
	// Parts is the model turn's parts exactly as they arrived, for callers
	// that need to replay this turn in a follow-up request. Replay the raw
	// parts rather than rebuilding them from Text/FunctionCalls: the rebuilt
	// version silently drops per-part fields this package does not model, and
	// at least one of them (ThoughtSignature) is mandatory on the way back.
	Parts []Part
}

// Generate runs one generateContent call. system is sent as the system
// instruction on every call (Gemini has no separate "system session"
// concept); contents is the full conversation so far, including any prior
// function calls/responses the caller has already appended.
func (c *Client) Generate(ctx context.Context, system string, contents []Content, tools []FunctionDeclaration) (Result, error) {
	req := generateRequest{Contents: contents}
	if system != "" {
		req.SystemInstruction = &Content{Parts: []Part{{Text: system}}}
	}
	if len(tools) > 0 {
		req.Tools = []toolSet{{FunctionDeclarations: tools}}
	}

	var resp generateResponse
	_, err := c.http.Do(ctx, httpjson.Request{
		Method: http.MethodPost,
		URL:    fmt.Sprintf("%s/%s:generateContent", baseURL, c.model),
		// Low-cardinality label — the model name, not any per-request value.
		Endpoint: "/models/{model}:generateContent",
		Header:   http.Header{"x-goog-api-key": []string{c.apiKey}},
		Body:     req,
	}, &resp)
	if err != nil {
		return Result{}, err
	}
	if resp.PromptFeedback != nil && resp.PromptFeedback.BlockReason != "" {
		return Result{}, fmt.Errorf("gemini blocked the prompt: %s", resp.PromptFeedback.BlockReason)
	}
	if len(resp.Candidates) == 0 {
		return Result{}, fmt.Errorf("gemini returned no candidates")
	}

	cand := resp.Candidates[0]
	out := Result{FinishReason: cand.FinishReason, Parts: cand.Content.Parts}
	for _, p := range cand.Content.Parts {
		if p.Text != "" {
			out.Text += p.Text
		}
		if p.FunctionCall != nil {
			out.FunctionCalls = append(out.FunctionCalls, *p.FunctionCall)
		}
	}
	return out, nil
}
