// Package observability holds the metrics registry and request
// correlation plumbing.
//
// Structured logs answer "what happened at 14:03". They cannot answer
// "what is the per-brand poll success rate over the last 24 hours" or "is
// cycle duration trending up as we add sites" — which are the only two
// questions anyone actually asks about a polling system. Those need
// aggregation over time, which means metrics.
//
// Implemented against the standard Prometheus client so this drops into
// any existing scrape config without inventing a bespoke format.
package observability

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	registry *prometheus.Registry

	cycleDuration  prometheus.Histogram
	cycleSites     prometheus.Gauge
	cycleErrors    prometheus.Counter
	cyclesTotal    prometheus.Counter
	brandSites     *prometheus.GaugeVec
	brandFailures  *prometheus.CounterVec
	adapterLatency *prometheus.HistogramVec
	adapterResults *prometheus.CounterVec
	alertsFired    *prometheus.CounterVec
	httpDuration   *prometheus.HistogramVec
	loginAttempts  *prometheus.CounterVec
}

func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()

	m := &Metrics{
		registry: reg,

		cycleDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "collector_cycle_duration_seconds",
			Help: "Wall time of a complete poll cycle across all brands.",
			// Tuned for a 5-minute interval: the interesting question is
			// whether a cycle is creeping toward the tick, so the buckets
			// bunch below a minute and then stretch.
			Buckets: []float64{1, 2.5, 5, 10, 20, 30, 45, 60, 90, 120, 240},
		}),
		cycleSites: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "collector_sites_polled",
			Help: "Sites touched by the most recent cycle.",
		}),
		cycleErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "collector_errors_total",
			Help: "Errors encountered across all cycles.",
		}),
		cyclesTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "collector_cycles_total",
			Help: "Completed poll cycles.",
		}),
		brandSites: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "collector_brand_sites",
			Help: "Sites per brand by outcome in the most recent cycle.",
		}, []string{"brand", "outcome"}),
		brandFailures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "collector_brand_fetch_failures_total",
			Help: "Cycles where a brand's FetchAll failed outright.",
		}, []string{"brand"}),
		adapterLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "adapter_request_duration_seconds",
			Help:    "Latency of a single HTTP attempt against a vendor API.",
			Buckets: prometheus.DefBuckets,
		}, []string{"brand", "endpoint"}),
		adapterResults: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "adapter_requests_total",
			Help: "Vendor API attempts by outcome. `status` is the HTTP code, or \"error\" for transport failures.",
		}, []string{"brand", "endpoint", "status"}),
		alertsFired: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "alerts_fired_total",
			Help: "Alerts raised, by type and severity.",
		}, []string{"type", "severity"}),
		httpDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "API handler latency.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
		}, []string{"method", "route", "status"}),
		loginAttempts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "auth_login_attempts_total",
			Help: "Login attempts by outcome — a brute-force attempt is visible here before it is anywhere else.",
		}, []string{"outcome"}),
	}

	reg.MustRegister(
		m.cycleDuration, m.cycleSites, m.cycleErrors, m.cyclesTotal,
		m.brandSites, m.brandFailures,
		m.adapterLatency, m.adapterResults,
		m.alertsFired, m.httpDuration, m.loginAttempts,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	return m
}

// Handler serves the Prometheus exposition format.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

func (m *Metrics) ObserveCycle(d time.Duration, sites, errors int) {
	m.cycleDuration.Observe(d.Seconds())
	m.cycleSites.Set(float64(sites))
	m.cycleErrors.Add(float64(errors))
	m.cyclesTotal.Inc()
}

func (m *Metrics) ObserveBrandCycle(brand string, online, offline, unknown int, failed bool) {
	m.brandSites.WithLabelValues(brand, "online").Set(float64(online))
	m.brandSites.WithLabelValues(brand, "offline").Set(float64(offline))
	m.brandSites.WithLabelValues(brand, "unknown").Set(float64(unknown))
	if failed {
		m.brandFailures.WithLabelValues(brand).Inc()
	}
}

// ObserveAdapterAttempt is wired into httpjson.Hooks so every vendor call —
// including retries — lands here without the adapters knowing metrics
// exist.
func (m *Metrics) ObserveAdapterAttempt(brand, endpoint string, status int, d time.Duration, err error) {
	m.adapterLatency.WithLabelValues(brand, endpoint).Observe(d.Seconds())

	// `endpoint` is deliberately a route shape, never an interpolated path.
	// Labelling by real path would mint a new time series per site and per
	// day, which is the classic way to melt a Prometheus server.
	label := "error"
	if err == nil || status != 0 {
		label = statusLabel(status)
	}
	m.adapterResults.WithLabelValues(brand, endpoint, label).Inc()
}

func (m *Metrics) ObserveAlert(alertType, severity string) {
	m.alertsFired.WithLabelValues(alertType, severity).Inc()
}

func (m *Metrics) ObserveHTTP(method, route string, status int, d time.Duration) {
	m.httpDuration.WithLabelValues(method, route, statusLabel(status)).Observe(d.Seconds())
}

func (m *Metrics) ObserveLogin(outcome string) {
	m.loginAttempts.WithLabelValues(outcome).Inc()
}

// statusLabel buckets by class rather than exact code, keeping cardinality
// flat while preserving the distinction that matters operationally.
func statusLabel(status int) string {
	switch {
	case status == 0:
		return "error"
	case status < 200:
		return "1xx"
	case status < 300:
		return "2xx"
	case status < 400:
		return "3xx"
	case status == 401 || status == 403:
		return "auth"
	case status == 429:
		return "429"
	case status < 500:
		return "4xx"
	default:
		return "5xx"
	}
}
