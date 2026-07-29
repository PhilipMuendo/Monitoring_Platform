package httpjson

import (
	"context"
	"sync"
	"time"
)

// TokenCache holds a bearer token and refreshes it through the supplied
// function shortly before it expires.
//
// Deye and Sosen both issue tokens with ~60-90 day lifetimes and both had
// grown their own copy of this mutex-plus-expiry dance. Beyond the
// duplication, each copy held its lock across the whole network call, so
// every goroutine in a fan-out blocked behind one refresh — and on failure
// they would all pile in and re-attempt simultaneously. Single-flight
// refresh here fixes that for every brand at once.
type TokenCache struct {
	// refreshBefore is how far ahead of expiry a token is considered stale,
	// so a long fan-out cycle can't start with a valid token and finish
	// with an expired one.
	refreshBefore time.Duration
	fetch         func(ctx context.Context) (token string, ttl time.Duration, err error)

	mu      sync.Mutex
	token   string
	expires time.Time
	// inflight is non-nil while a refresh is running; concurrent callers
	// wait on it instead of starting their own.
	inflight chan struct{}
	lastErr  error
}

func NewTokenCache(refreshBefore time.Duration, fetch func(ctx context.Context) (string, time.Duration, error)) *TokenCache {
	if refreshBefore <= 0 {
		refreshBefore = time.Hour
	}
	return &TokenCache{refreshBefore: refreshBefore, fetch: fetch}
}

// Get returns a valid token, refreshing it if needed. Concurrent callers
// during a refresh block until it completes and then share the result.
func (c *TokenCache) Get(ctx context.Context) (string, error) {
	for {
		c.mu.Lock()
		if c.token != "" && time.Now().Before(c.expires.Add(-c.refreshBefore)) {
			tok := c.token
			c.mu.Unlock()
			return tok, nil
		}
		if c.inflight != nil {
			wait := c.inflight
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-wait:
			}
			// Loop round: the winner has published a token or an error.
			continue
		}
		done := make(chan struct{})
		c.inflight = done
		c.mu.Unlock()

		token, ttl, err := c.fetch(ctx)

		c.mu.Lock()
		if err == nil {
			c.token = token
			c.expires = time.Now().Add(ttl)
			c.lastErr = nil
		} else {
			// Drop the cached token on auth failure so the next cycle
			// re-authenticates rather than replaying a token the vendor
			// has already rejected.
			if Unauthorized(err) {
				c.token = ""
			}
			c.lastErr = err
		}
		c.inflight = nil
		c.mu.Unlock()
		close(done)

		if err != nil {
			return "", err
		}
		return token, nil
	}
}

// Invalidate forces the next Get to re-authenticate. Adapters call this
// when a request fails with 401 despite a cached token — the vendor may
// have revoked it early.
func (c *TokenCache) Invalidate() {
	c.mu.Lock()
	c.token = ""
	c.mu.Unlock()
}
