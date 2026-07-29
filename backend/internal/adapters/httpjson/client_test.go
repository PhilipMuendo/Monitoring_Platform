package httpjson

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func testConfig() Config {
	c := Defaults()
	// Keep the suite fast; the backoff maths is exercised directly below.
	c.BaseBackoff = time.Millisecond
	c.MaxBackoff = 4 * time.Millisecond
	c.MaxRetryAfter = 20 * time.Millisecond
	return c
}

// The whole point of this package: a transient 500 must not surface as a
// failure when a retry would have succeeded. Before it existed, that 500
// became StatusOffline, which became a critical alert.
func TestRetriesTransientServerError(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]int{"value": 42})
	}))
	defer srv.Close()

	c := New("test", testConfig(), Hooks{})
	var out struct {
		Value int `json:"value"`
	}
	if _, err := c.Do(t.Context(), Request{Method: http.MethodGet, URL: srv.URL, Endpoint: "/x"}, &out); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Value != 42 {
		t.Errorf("value = %d, want 42", out.Value)
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("server saw %d calls, want 3", got)
	}
}

// 401 is the vendor rejecting our credentials. Retrying is pointless and
// hammering an auth endpoint is how an installer account gets locked.
func TestDoesNotRetryUnauthorized(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := New("test", testConfig(), Hooks{})
	_, err := c.Do(t.Context(), Request{Method: http.MethodGet, URL: srv.URL, Endpoint: "/x"}, nil)
	if err == nil {
		t.Fatal("expected an error")
	}
	if !Unauthorized(err) {
		t.Errorf("Unauthorized(err) = false, want true (%v)", err)
	}
	if IsTransient(err) {
		t.Error("401 must not be classified transient")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("server saw %d calls, want exactly 1", got)
	}
}

func TestHonoursRetryAfterSeconds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := New("test", testConfig(), Hooks{})
	if _, err := c.Do(t.Context(), Request{Method: http.MethodGet, URL: srv.URL, Endpoint: "/x"}, nil); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("server saw %d calls, want 2 (429 then success)", got)
	}
}

// A vendor answering "come back in an hour" must not wedge the poll cycle
// for an hour.
func TestRetryAfterIsCapped(t *testing.T) {
	c := New("test", testConfig(), Hooks{})
	if got := c.backoff(1, time.Hour); got != c.cfg.MaxRetryAfter {
		t.Errorf("backoff with 1h Retry-After = %v, want the %v cap", got, c.cfg.MaxRetryAfter)
	}
}

func TestBackoffIsJitteredAndBounded(t *testing.T) {
	c := New("test", Defaults(), Hooks{})
	seen := map[time.Duration]bool{}
	for i := 0; i < 40; i++ {
		d := c.backoff(3, 0)
		if d <= 0 || d > c.cfg.MaxBackoff+c.cfg.BaseBackoff {
			t.Fatalf("backoff out of range: %v", d)
		}
		seen[d] = true
	}
	// Fixed exponential backoff makes every site of a brand retry in
	// lockstep, turning a vendor wobble into a self-inflicted herd.
	if len(seen) < 5 {
		t.Errorf("backoff produced %d distinct delays over 40 draws; jitter looks absent", len(seen))
	}
}

func TestParseRetryAfterAcceptsHTTPDate(t *testing.T) {
	future := time.Now().Add(3 * time.Second).UTC().Format(http.TimeFormat)
	got := parseRetryAfter(future)
	if got < time.Second || got > 4*time.Second {
		t.Errorf("parseRetryAfter(date) = %v, want ~3s", got)
	}
	if parseRetryAfter("") != 0 {
		t.Error("empty Retry-After should yield 0")
	}
	if parseRetryAfter("-5") != 0 {
		t.Error("negative delta-seconds should yield 0")
	}
}

// Ingecon requires the caller to send Accept-Encoding: gzip, which
// disables Go's automatic decompression and hands back raw gzip bytes.
func TestDecodesManualGzip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		gz.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New("test", testConfig(), Hooks{})
	var out struct {
		OK bool `json:"ok"`
	}
	if _, err := c.Do(t.Context(), Request{
		Method:   http.MethodGet,
		URL:      srv.URL,
		Endpoint: "/x",
		Header:   http.Header{"Accept-Encoding": []string{"gzip"}},
	}, &out); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if !out.OK {
		t.Error("gzip body did not decode")
	}
}

// An unparseable body is a contract change, not a blip — retrying just
// fetches the same bytes again.
func TestDecodeFailureIsNotRetried(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Write([]byte(`<html>not json</html>`))
	}))
	defer srv.Close()

	c := New("test", testConfig(), Hooks{})
	var out map[string]any
	if _, err := c.Do(t.Context(), Request{Method: http.MethodGet, URL: srv.URL, Endpoint: "/x"}, &out); err == nil {
		t.Fatal("expected a decode error")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("server saw %d calls, want 1", got)
	}
}

func TestHooksObserveEveryAttempt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	var attempts int32
	c := New("test", testConfig(), Hooks{
		OnAttempt: func(brand, endpoint string, status int, d time.Duration, err error) {
			atomic.AddInt32(&attempts, 1)
			if brand != "test" || endpoint != "/x" {
				t.Errorf("hook got brand=%q endpoint=%q", brand, endpoint)
			}
		},
	})
	_, _ = c.Do(t.Context(), Request{Method: http.MethodGet, URL: srv.URL, Endpoint: "/x"}, nil)

	if got := atomic.LoadInt32(&attempts); got != int32(c.cfg.MaxAttempts) {
		t.Errorf("hook fired %d times, want %d (once per attempt incl. retries)", got, c.cfg.MaxAttempts)
	}
}

func TestContextCancellationStopsRetries(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	cfg := testConfig()
	cfg.BaseBackoff = 250 * time.Millisecond
	cfg.MaxAttempts = 5
	c := New("test", cfg, Hooks{})

	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Millisecond)
	defer cancel()

	start := time.Now()
	if _, err := c.Do(ctx, Request{Method: http.MethodGet, URL: srv.URL, Endpoint: "/x"}, nil); err == nil {
		t.Fatal("expected an error")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("kept retrying for %v after context expiry", elapsed)
	}
}

// Single-flight: a fan-out of goroutines hitting an expired token must
// produce one authentication call, not one per goroutine.
func TestTokenCacheRefreshesOnce(t *testing.T) {
	var fetches int32
	tc := NewTokenCache(time.Minute, func(ctx context.Context) (string, time.Duration, error) {
		atomic.AddInt32(&fetches, 1)
		time.Sleep(20 * time.Millisecond)
		return "tok", time.Hour, nil
	})

	done := make(chan struct{})
	for i := 0; i < 12; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			if got, err := tc.Get(t.Context()); err != nil || got != "tok" {
				t.Errorf("Get = %q, %v", got, err)
			}
		}()
	}
	for i := 0; i < 12; i++ {
		<-done
	}

	if got := atomic.LoadInt32(&fetches); got != 1 {
		t.Errorf("authenticated %d times under concurrency, want 1", got)
	}
}

func TestTokenCacheRefreshesBeforeExpiry(t *testing.T) {
	var fetches int32
	tc := NewTokenCache(time.Hour, func(ctx context.Context) (string, time.Duration, error) {
		atomic.AddInt32(&fetches, 1)
		// TTL shorter than refreshBefore: always considered stale.
		return "tok", 30 * time.Minute, nil
	})
	for i := 0; i < 3; i++ {
		if _, err := tc.Get(t.Context()); err != nil {
			t.Fatalf("Get: %v", err)
		}
	}
	if got := atomic.LoadInt32(&fetches); got != 3 {
		t.Errorf("fetched %d times, want 3 — a token inside the refresh window must not be reused", got)
	}
}
