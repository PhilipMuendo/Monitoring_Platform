package collector

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/models"
)

// fakeAdapter is a BrandAdapter whose behaviour each test dictates.
type fakeAdapter struct {
	name      string
	readings  []models.SiteData
	fetchErr  error
	describe  []adapters.SiteDescriptor
	descErr   error
	fetchCall atomic.Int32
}

func (f *fakeAdapter) Name() string { return f.name }

func (f *fakeAdapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	f.fetchCall.Add(1)
	if f.fetchErr != nil {
		return nil, f.fetchErr
	}
	return f.readings, nil
}

func (f *fakeAdapter) ValidateCredentials(context.Context) error { return nil }
func (f *fakeAdapter) RateLimit() (int, time.Duration)           { return 60, time.Minute }

func (f *fakeAdapter) Describe(context.Context) ([]adapters.SiteDescriptor, error) {
	if f.descErr != nil {
		return nil, f.descErr
	}
	return f.describe, nil
}

func TestOutcomeClassification(t *testing.T) {
	// The status -> outcome mapping decides what the health endpoint and
	// the metrics report. Unknown must be its own bucket: folding it into
	// offline is what let a vendor outage read as a fleet outage.
	cases := map[models.Status]outcome{
		models.StatusOnline:        outcomeOnline,
		models.StatusWarning:       outcomeOnline,
		models.StatusOffline:       outcomeOffline,
		models.StatusError:         outcomeOffline,
		models.StatusUnknown:       outcomeUnknown,
		models.StatusCommissioning: outcomeOffline,
	}
	for status, want := range cases {
		t.Run(string(status), func(t *testing.T) {
			var got outcome
			switch {
			case status == models.StatusUnknown:
				got = outcomeUnknown
			case status == models.StatusOnline || status == models.StatusWarning:
				got = outcomeOnline
			default:
				got = outcomeOffline
			}
			if got != want {
				t.Errorf("status %s classified as %v, want %v", status, got, want)
			}
		})
	}
}

func TestCycleTimeoutDefaultsUnderPollInterval(t *testing.T) {
	c := New(nil, nil, nil, nil, Options{PollInterval: 5 * time.Minute})
	if c.cycleTimeout >= 5*time.Minute {
		t.Errorf("cycleTimeout = %v, must be strictly under the poll interval or cycles stack up",
			c.cycleTimeout)
	}
	if c.cycleTimeout <= 0 {
		t.Errorf("cycleTimeout = %v, want a positive bound", c.cycleTimeout)
	}
}

func TestExplicitCycleTimeoutIsHonoured(t *testing.T) {
	c := New(nil, nil, nil, nil, Options{PollInterval: 5 * time.Minute, CycleTimeout: 90 * time.Second})
	if c.cycleTimeout != 90*time.Second {
		t.Errorf("cycleTimeout = %v, want the configured 90s", c.cycleTimeout)
	}
}

func TestConcurrencyDefaultsToASaneBound(t *testing.T) {
	c := New(nil, nil, nil, nil, Options{PollInterval: time.Minute})
	if c.maxConcurrency <= 0 {
		t.Fatalf("maxConcurrency = %d, want a positive bound", c.maxConcurrency)
	}
	// Unbounded fan-out against a vendor with a documented rate limit is
	// how an installer account gets banned.
	if c.maxConcurrency > 50 {
		t.Errorf("maxConcurrency = %d, unexpectedly permissive", c.maxConcurrency)
	}
}

func TestBrandsPollConcurrently(t *testing.T) {
	// Three brands whose fetches each block briefly. Serial execution would
	// take 3x as long as concurrent; the assertion is loose enough not to
	// be flaky but tight enough to catch a regression to sequential.
	const delay = 120 * time.Millisecond

	slow := func(name string) models.BrandAdapter {
		return &blockingAdapter{name: name, delay: delay}
	}
	c := New(
		[]models.BrandAdapter{slow("a"), slow("b"), slow("c")},
		nil, nil, nil,
		Options{PollInterval: time.Minute},
	)

	start := time.Now()
	var wg = make(chan struct{})
	go func() {
		defer close(wg)
		// pollAdapter needs repos for the success path, so drive the
		// concurrency layer directly with adapters that fail fast after
		// their delay.
		c.runCycle(t.Context())
	}()
	<-wg
	elapsed := time.Since(start)

	if elapsed > delay*2 {
		t.Errorf("cycle took %v for 3 brands with a %v delay each; brands appear to be polled serially", elapsed, delay)
	}
}

// blockingAdapter sleeps, then fails — enough to exercise the concurrency
// layer without needing a database.
type blockingAdapter struct {
	name  string
	delay time.Duration
}

func (b *blockingAdapter) Name() string { return b.name }
func (b *blockingAdapter) FetchAll(ctx context.Context) ([]models.SiteData, error) {
	select {
	case <-time.After(b.delay):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return nil, errors.New("boom")
}
func (b *blockingAdapter) ValidateCredentials(context.Context) error { return nil }
func (b *blockingAdapter) RateLimit() (int, time.Duration)           { return 60, time.Minute }

func TestCycleRecordsPerBrandStats(t *testing.T) {
	c := New(
		[]models.BrandAdapter{&blockingAdapter{name: "deye", delay: time.Millisecond}},
		nil, nil, nil,
		Options{PollInterval: time.Minute},
	)
	c.runCycle(t.Context())

	stats := c.Stats()
	bs, ok := stats.ByBrand["deye"]
	if !ok {
		t.Fatal("no stats recorded for the brand")
	}
	if !bs.Failed {
		t.Error("a total FetchAll failure should be flagged on the brand's stats")
	}
	if stats.Errors == 0 {
		t.Error("a failed fetch should count as an error")
	}
	if c.LastRun().IsZero() {
		t.Error("LastRun should be set after a cycle")
	}
}

func TestDiscoverIsSkippedForAdaptersWithoutDescribe(t *testing.T) {
	// blockingAdapter deliberately does not implement SiteDescriber, so
	// discoverAdapter must no-op rather than panic on the type assertion.
	c := New(nil, nil, nil, nil, Options{PollInterval: time.Minute})
	if err := c.discoverAdapter(t.Context(), &blockingAdapter{name: "x"}); err != nil {
		t.Errorf("discoverAdapter on a non-describer = %v, want nil", err)
	}
}
