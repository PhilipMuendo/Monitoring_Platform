package auth

import (
	"testing"
	"time"
)

func testThrottle(t *testing.T) (*Throttle, *time.Time) {
	t.Helper()
	now := time.Now()
	th := NewThrottle(ThrottleConfig{MaxFailures: 3, Window: time.Minute, Lockout: 5 * time.Minute})
	th.nowFn = func() time.Time { return now }
	return th, &now
}

func TestAllowsUntilTheFailureLimit(t *testing.T) {
	th, _ := testThrottle(t)

	for i := 0; i < 2; i++ {
		if ok, _ := th.Allowed("k"); !ok {
			t.Fatalf("blocked after %d failures, limit is 3", i)
		}
		th.RecordFailure("k")
	}
	if ok, _ := th.Allowed("k"); !ok {
		t.Fatal("blocked before reaching the limit")
	}
}

func TestLocksOutAtTheLimit(t *testing.T) {
	th, _ := testThrottle(t)

	for i := 0; i < 3; i++ {
		th.RecordFailure("k")
	}
	ok, retryAfter := th.Allowed("k")
	if ok {
		t.Fatal("expected lockout after hitting the failure limit")
	}
	if retryAfter <= 0 || retryAfter > 5*time.Minute {
		t.Errorf("retryAfter = %v, want a positive value within the lockout", retryAfter)
	}
}

func TestLockoutExpires(t *testing.T) {
	th, now := testThrottle(t)

	for i := 0; i < 3; i++ {
		th.RecordFailure("k")
	}
	if ok, _ := th.Allowed("k"); ok {
		t.Fatal("expected lockout")
	}

	*now = now.Add(6 * time.Minute)
	if ok, _ := th.Allowed("k"); !ok {
		t.Fatal("lockout should have expired")
	}
}

// A user who mistypes their password twice, gets it right, then mistypes
// twice more must not be locked out. Only consecutive-ish failures count.
func TestSuccessClearsFailures(t *testing.T) {
	th, _ := testThrottle(t)

	th.RecordFailure("k")
	th.RecordFailure("k")
	th.RecordSuccess("k")
	th.RecordFailure("k")
	th.RecordFailure("k")

	if ok, _ := th.Allowed("k"); !ok {
		t.Fatal("a successful login must reset the failure counter")
	}
}

// Failures older than the window shouldn't accumulate toward a lockout.
func TestFailureWindowRollsOver(t *testing.T) {
	th, now := testThrottle(t)

	th.RecordFailure("k")
	th.RecordFailure("k")

	*now = now.Add(2 * time.Minute) // past the 1-minute window
	th.RecordFailure("k")

	if ok, _ := th.Allowed("k"); !ok {
		t.Fatal("stale failures should not count toward the limit")
	}
}

// Locking one account must not lock another, or a single attacker could
// deny service to the whole user base by guessing at one victim.
func TestKeysAreIndependent(t *testing.T) {
	th, _ := testThrottle(t)

	for i := 0; i < 3; i++ {
		th.RecordFailure("victim@example.test|1.2.3.4")
	}
	if ok, _ := th.Allowed("victim@example.test|1.2.3.4"); ok {
		t.Fatal("expected the attacked key to be locked")
	}
	if ok, _ := th.Allowed("someone-else@example.test|5.6.7.8"); !ok {
		t.Fatal("an unrelated key must be unaffected")
	}
}

// Unauthenticated input drives map keys here, so entries have to be
// evicted or this is a slow memory leak an attacker controls.
func TestStaleEntriesAreEvicted(t *testing.T) {
	th, now := testThrottle(t)

	for i := 0; i < 500; i++ {
		th.RecordFailure(string(rune(i)) + "@spam.test|9.9.9.9")
	}
	if len(th.attempts) < 400 {
		t.Fatalf("expected the attempts map to be populated, got %d", len(th.attempts))
	}

	*now = now.Add(30 * time.Minute)
	th.Allowed("trigger-a-sweep")

	if len(th.attempts) > 10 {
		t.Errorf("stale entries were not evicted: %d remain", len(th.attempts))
	}
}
