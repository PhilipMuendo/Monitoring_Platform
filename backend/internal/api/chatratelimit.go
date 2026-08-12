package api

import (
	"sync"
	"time"
)

// chatLimiter is a simple in-memory sliding-window rate limiter, scoped
// per user, guarding the one endpoint in this API that calls a metered
// third-party LLM. It is process-local — fine for the single-VPS
// deployment this platform targets; a multi-instance deployment would
// need this backed by something shared (e.g. Redis) instead.
type chatLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func NewChatLimiter() *chatLimiter {
	return &chatLimiter{hits: make(map[string][]time.Time)}
}

// Allow reports whether the user has made fewer than max requests within
// the trailing window, recording this call as a hit if so.
func (l *chatLimiter) Allow(userID string, max int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-window)

	kept := l.hits[userID][:0]
	for _, t := range l.hits[userID] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= max {
		l.hits[userID] = kept
		return false
	}
	l.hits[userID] = append(kept, now)
	return true
}
