// Package httpjson is the shared transport every brand adapter sits on.
//
// It exists for two reasons. The obvious one is deduplication: all three
// adapters had independently grown the same ~150 lines of client
// construction, bearer-token caching, status checking, gzip handling and
// error wrapping.
//
// The important one is that retry policy belongs in exactly one place. The
// adapters previously had none at all, so a single transient 500 from a
// vendor turned into a site marked offline, which turned into a critical
// alert. Retries, jittered backoff, Retry-After handling and the
// distinction between "retryable" and "give up" are all decided here so
// every brand inherits the same behaviour.
package httpjson

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"strconv"
	"time"
)

// Config tunes a Client. The zero value is usable; Defaults fills in
// production-sensible values.
type Config struct {
	// Timeout bounds a single attempt, not the whole retry sequence.
	Timeout time.Duration
	// MaxAttempts includes the first try, so 3 means "try, retry, retry".
	MaxAttempts int
	// BaseBackoff is the first retry delay; subsequent delays double it.
	BaseBackoff time.Duration
	// MaxBackoff caps exponential growth.
	MaxBackoff time.Duration
	// MaxRetryAfter caps how long we will honour a server's Retry-After.
	// A vendor answering "come back in an hour" must not wedge a poll
	// cycle for an hour — we give up and let the next cycle try.
	MaxRetryAfter time.Duration
}

func Defaults() Config {
	return Config{
		Timeout:       20 * time.Second,
		MaxAttempts:   3,
		BaseBackoff:   400 * time.Millisecond,
		MaxBackoff:    5 * time.Second,
		MaxRetryAfter: 30 * time.Second,
	}
}

type Client struct {
	brand  string
	http   *http.Client
	cfg    Config
	rng    *rand.Rand
	hooks  Hooks
	logger *slog.Logger
}

// Hooks lets the caller observe every completed request without this
// package importing a metrics library.
type Hooks struct {
	// OnAttempt fires once per HTTP attempt, including retries.
	OnAttempt func(brand, endpoint string, status int, duration time.Duration, err error)
}

func New(brand string, cfg Config, hooks Hooks) *Client {
	if cfg.Timeout <= 0 {
		cfg = Defaults()
	}
	return &Client{
		brand: brand,
		http:  &http.Client{Timeout: cfg.Timeout},
		cfg:   cfg,
		// Per-client source, seeded off the clock, purely to decorrelate
		// backoff between brands polling concurrently. Not security code.
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
		hooks:  hooks,
		logger: slog.With("brand", brand),
	}
}

// Error carries the HTTP status alongside the message so callers can tell
// "the vendor rejected our credentials" (fatal, stop polling this brand)
// from "the vendor is having a moment" (transient, keep the last reading).
type Error struct {
	Endpoint string
	Status   int
	Body     string
	Err      error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Endpoint, e.Err)
	}
	return fmt.Sprintf("%s: HTTP %d: %s", e.Endpoint, e.Status, truncate(e.Body, 300))
}

func (e *Error) Unwrap() error { return e.Err }

// Transient reports whether retrying later could plausibly succeed. Auth
// and "not found" failures are permanent until a human intervenes; network
// errors, timeouts, 429 and 5xx are not.
func (e *Error) Transient() bool {
	if e == nil {
		return false
	}
	if e.Err != nil {
		return true // transport-level: timeout, connection reset, DNS
	}
	return e.Status == http.StatusTooManyRequests || e.Status >= 500
}

// IsTransient reports whether err is a retryable transport/server failure.
// Adapters use it to decide between "degrade this site to unknown" and
// "surface a real error".
func IsTransient(err error) bool {
	var e *Error
	if errors.As(err, &e) {
		return e.Transient()
	}
	// A non-Error failure at this layer is almost always context
	// cancellation or a decode bug; neither should be retried blindly.
	return false
}

// Unauthorized reports whether err was the vendor rejecting our
// credentials, which no amount of retrying will fix.
func Unauthorized(err error) bool {
	var e *Error
	if errors.As(err, &e) {
		return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden
	}
	return false
}

// Request describes one call. Header values are applied after the
// defaults, so a caller can override Accept-Encoding if it needs to.
type Request struct {
	Method string
	URL    string
	// Endpoint is a low-cardinality label for logs and metrics — use the
	// route shape ("/v1.0/station/latest"), never the interpolated path,
	// or the metrics registry grows a series per site.
	Endpoint string
	Header   http.Header
	Body     any
}

// Do executes req with retries and decodes a successful JSON response into
// out (which may be nil to discard the body). It returns the raw body too,
// because several adapters persist it verbatim as the reading's raw_data.
func (c *Client) Do(ctx context.Context, req Request, out any) ([]byte, error) {
	var payload []byte
	if req.Body != nil {
		var err error
		payload, err = json.Marshal(req.Body)
		if err != nil {
			return nil, &Error{Endpoint: req.Endpoint, Err: fmt.Errorf("marshal body: %w", err)}
		}
	}

	var lastErr error
	for attempt := 1; attempt <= c.cfg.MaxAttempts; attempt++ {
		raw, retryAfter, err := c.attempt(ctx, req, payload)
		if err == nil {
			if out != nil {
				if decErr := json.Unmarshal(raw, out); decErr != nil {
					// A body that doesn't parse is a contract change, not a
					// blip. Retrying an identical request would just produce
					// the same unparseable bytes.
					return raw, &Error{Endpoint: req.Endpoint, Err: fmt.Errorf("decode: %w", decErr)}
				}
			}
			return raw, nil
		}

		lastErr = err
		if !IsTransient(err) || attempt == c.cfg.MaxAttempts {
			break
		}

		delay := c.backoff(attempt, retryAfter)
		c.logger.Warn("request failed, retrying",
			"endpoint", req.Endpoint, "attempt", attempt, "of", c.cfg.MaxAttempts,
			"retry_in", delay.String(), "error", err)

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(delay):
		}
	}
	return nil, lastErr
}

func (c *Client) attempt(ctx context.Context, req Request, payload []byte) (body []byte, retryAfter time.Duration, err error) {
	start := time.Now()
	status := 0
	defer func() {
		if c.hooks.OnAttempt != nil {
			c.hooks.OnAttempt(c.brand, req.Endpoint, status, time.Since(start), err)
		}
	}()

	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL, reader)
	if err != nil {
		return nil, 0, &Error{Endpoint: req.Endpoint, Err: err}
	}
	httpReq.Header.Set("Accept", "application/json")
	if payload != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	for k, vs := range req.Header {
		httpReq.Header[http.CanonicalHeaderKey(k)] = vs
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, 0, &Error{Endpoint: req.Endpoint, Err: err}
	}
	defer resp.Body.Close()
	status = resp.StatusCode

	raw, err := readBody(resp)
	if err != nil {
		return nil, 0, &Error{Endpoint: req.Endpoint, Status: status, Err: err}
	}

	if status < 200 || status >= 300 {
		return nil, parseRetryAfter(resp.Header.Get("Retry-After")),
			&Error{Endpoint: req.Endpoint, Status: status, Body: string(raw)}
	}
	return raw, 0, nil
}

// readBody transparently gunzips when the caller asked for gzip.
//
// Go's transport decompresses automatically only when it set
// Accept-Encoding itself; Ingecon's API *requires* the caller to send that
// header, which disables the automatic path and hands back raw gzip.
func readBody(resp *http.Response) ([]byte, error) {
	var r io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("gzip: %w", err)
		}
		defer gz.Close()
		r = gz
	}
	return io.ReadAll(r)
}

// backoff returns exponential delay with full jitter, unless the server
// told us exactly how long to wait.
//
// Full jitter (uniform over [0, exp]) rather than fixed exponential: every
// site of a brand backs off at the same instant otherwise, and they all
// retry in lockstep, which is how a brief vendor wobble becomes a
// self-inflicted thundering herd.
func (c *Client) backoff(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		if retryAfter > c.cfg.MaxRetryAfter {
			return c.cfg.MaxRetryAfter
		}
		return retryAfter
	}
	exp := float64(c.cfg.BaseBackoff) * math.Pow(2, float64(attempt-1))
	if exp > float64(c.cfg.MaxBackoff) {
		exp = float64(c.cfg.MaxBackoff)
	}
	return time.Duration(c.rng.Int63n(int64(exp)) + int64(c.cfg.BaseBackoff)/2)
}

// parseRetryAfter handles both forms in RFC 9110: delta-seconds and an
// HTTP-date.
func parseRetryAfter(v string) time.Duration {
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil {
		if secs < 0 {
			return 0
		}
		return time.Duration(secs) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
