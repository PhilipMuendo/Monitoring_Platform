package auth

import (
	"sync"
	"time"
)

// Throttle rate-limits failed authentication attempts.
//
// Two distinct problems, both real:
//
//  1. Credential stuffing. Login was previously unbounded, so an attacker
//     could try passwords as fast as the network allowed.
//  2. CPU exhaustion. bcrypt is *deliberately* expensive — that is the
//     whole point of it — which means an unauthenticated endpoint that
//     runs bcrypt per request is a cheap denial-of-service. A few hundred
//     concurrent login attempts will saturate the box, and no valid user
//     can log in either.
//
// Keyed on both the account and the client IP, because either alone is
// insufficient: per-account only lets a botnet spray one password across
// every account, and per-IP only lets an attacker behind a large NAT lock
// out everyone sharing it.
//
// Only *failures* count. A user who logs in correctly fifty times is not
// an attacker, and throttling them would be a self-inflicted outage.
type Throttle struct {
	max      int
	window   time.Duration
	lockout  time.Duration
	nowFn    func() time.Time
	mu       sync.Mutex
	attempts map[string]*attemptRecord
	// lastSweep bounds map growth: without eviction, every distinct
	// attacker-supplied username is a permanent map entry, which is a slow
	// memory leak driven by unauthenticated input.
	lastSweep time.Time
}

type attemptRecord struct {
	count       int
	windowStart time.Time
	lockedUntil time.Time
}

type ThrottleConfig struct {
	// MaxFailures within Window before a lockout begins.
	MaxFailures int
	Window      time.Duration
	// Lockout is how long further attempts are refused after the limit.
	Lockout time.Duration
}

func DefaultThrottleConfig() ThrottleConfig {
	return ThrottleConfig{
		// Generous enough that a person mistyping their password a few
		// times is unaffected, tight enough that online guessing is
		// hopeless.
		MaxFailures: 8,
		Window:      5 * time.Minute,
		Lockout:     15 * time.Minute,
	}
}

func NewThrottle(cfg ThrottleConfig) *Throttle {
	if cfg.MaxFailures <= 0 {
		cfg = DefaultThrottleConfig()
	}
	return &Throttle{
		max:       cfg.MaxFailures,
		window:    cfg.Window,
		lockout:   cfg.Lockout,
		nowFn:     time.Now,
		attempts:  make(map[string]*attemptRecord),
		lastSweep: time.Now(),
	}
}

// Allowed reports whether an attempt for this key may proceed, and if not,
// how long the caller should be told to wait.
//
// Call it *before* doing any expensive work — that ordering is the whole
// CPU-exhaustion defence.
func (t *Throttle) Allowed(key string) (bool, time.Duration) {
	now := t.nowFn()

	t.mu.Lock()
	defer t.mu.Unlock()
	t.sweepLocked(now)

	rec, ok := t.attempts[key]
	if !ok {
		return true, 0
	}
	if now.Before(rec.lockedUntil) {
		return false, rec.lockedUntil.Sub(now)
	}
	return true, 0
}

// RecordFailure counts a failed attempt and starts a lockout at the limit.
func (t *Throttle) RecordFailure(key string) {
	now := t.nowFn()

	t.mu.Lock()
	defer t.mu.Unlock()
	t.sweepLocked(now)

	rec, ok := t.attempts[key]
	if !ok || now.Sub(rec.windowStart) > t.window {
		t.attempts[key] = &attemptRecord{count: 1, windowStart: now}
		return
	}
	rec.count++
	if rec.count >= t.max {
		rec.lockedUntil = now.Add(t.lockout)
		// Reset the counter so the lockout is a fixed period rather than
		// extending on every further attempt — an attacker who keeps
		// hammering shouldn't be able to lock a real user out indefinitely.
		rec.count = 0
		rec.windowStart = now
	}
}

// RecordSuccess clears any accumulated failures for the key.
func (t *Throttle) RecordSuccess(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.attempts, key)
}

// sweepLocked evicts stale records. Runs at most once a minute so the cost
// is amortised away from the hot path.
func (t *Throttle) sweepLocked(now time.Time) {
	if now.Sub(t.lastSweep) < time.Minute {
		return
	}
	t.lastSweep = now
	for k, rec := range t.attempts {
		if now.After(rec.lockedUntil) && now.Sub(rec.windowStart) > t.window {
			delete(t.attempts, k)
		}
	}
}
