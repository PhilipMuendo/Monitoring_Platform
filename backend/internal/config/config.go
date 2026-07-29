// Package config loads and validates all runtime configuration from
// environment variables exactly once at boot into a typed struct, so
// nothing downstream ever calls os.Getenv directly.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type DBConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	Name     string
	SSLMode  string
}

func (d DBConfig) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode)
}

type DeyeConfig struct {
	AppID    string
	Secret   string
	Username string
	Password string
	Region   string // "eu" or "as"
}

// Configured reports whether this brand has everything it needs to
// authenticate. An adapter that isn't configured is never registered, so
// the collector only ever polls portals we're actually integrated with —
// a half-filled credential set is treated as "not integrated" rather than
// registered and left to fail on every cycle.
func (c DeyeConfig) Configured() bool {
	return c.AppID != "" && c.Secret != "" && c.Username != "" && c.Password != ""
}

type IngeconConfig struct {
	APIKey  string
	BaseURL string
}

func (c IngeconConfig) Configured() bool { return c.APIKey != "" }

type SosenConfig struct {
	Username string
	Password string
}

func (c SosenConfig) Configured() bool { return c.Username != "" && c.Password != "" }

type Config struct {
	Port string
	DB   DBConfig

	// JWTSecret signs new access tokens. JWTKeyID names it in the token
	// header so it can be rotated: publish a new secret under a new ID,
	// move the old pair into JWTPreviousKeys, and existing sessions keep
	// verifying until they expire naturally.
	JWTSecret        string
	JWTKeyID         string
	JWTPreviousKeys  []KeyPair
	JWTAccessTTL     time.Duration
	JWTRefreshTTL    time.Duration
	PollInterval     time.Duration
	CollectorTimeout time.Duration
	// MaxConcurrency bounds in-flight per-site requests within one brand.
	MaxConcurrency    int
	LogLevel          string
	CORSAllowedOrigin string
	// SecureCookies marks the refresh cookie Secure. Defaults to on and
	// must be explicitly disabled for plain-HTTP local development —
	// getting this wrong in the safe direction just breaks localhost,
	// whereas the unsafe direction ships a session cookie over plaintext.
	SecureCookies bool
	// MetricsEnabled exposes /metrics. Separate from the API surface so it
	// can be left off when nothing is scraping.
	MetricsEnabled bool

	LoginMaxFailures int
	LoginWindow      time.Duration
	LoginLockout     time.Duration

	Deye    DeyeConfig
	Ingecon IngeconConfig
	Sosen   SosenConfig

	AdminSeedEmail    string
	AdminSeedPassword string
	AdminSeedName     string

	// Timezone offset for the "is it daytime" alert-engine check.
	// The brief hardcodes a single-country (Kenya, EAT = UTC+3) deployment.
	DaytimeStartHour int
	DaytimeEndHour   int
}

func Load() (*Config, error) {
	cfg := &Config{
		Port: getEnv("PORT", "8080"),
		DB: DBConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "solar_admin"),
			Password: getEnv("DB_PASSWORD", "solar_dev_password"),
			Name:     getEnv("DB_NAME", "solar_monitor"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
		JWTSecret:         getEnv("JWT_SECRET", "change_me_in_production"),
		JWTKeyID:          getEnv("JWT_KEY_ID", "default"),
		JWTPreviousKeys:   parseKeyring(getEnv("JWT_PREVIOUS_KEYS", "")),
		JWTAccessTTL:      getDuration("JWT_ACCESS_TTL", 15*time.Minute),
		JWTRefreshTTL:     getDuration("JWT_REFRESH_TTL", 30*24*time.Hour),
		PollInterval:      getDuration("POLL_INTERVAL", 5*time.Minute),
		CollectorTimeout:  getDuration("COLLECTOR_TIMEOUT", 0), // 0 = derive from PollInterval
		MaxConcurrency:    getInt("COLLECTOR_MAX_CONCURRENCY", 10),
		LogLevel:          getEnv("LOG_LEVEL", "info"),
		CORSAllowedOrigin: getEnv("CORS_ALLOWED_ORIGIN", "http://localhost:3000"),
		SecureCookies:     getBool("SECURE_COOKIES", true),
		MetricsEnabled:    getBool("METRICS_ENABLED", true),
		LoginMaxFailures:  getInt("LOGIN_MAX_FAILURES", 8),
		LoginWindow:       getDuration("LOGIN_FAILURE_WINDOW", 5*time.Minute),
		LoginLockout:      getDuration("LOGIN_LOCKOUT", 15*time.Minute),

		Deye: DeyeConfig{
			AppID:    getEnv("DEYE_APP_ID", ""),
			Secret:   getEnv("DEYE_APP_SECRET", ""),
			Username: getEnv("DEYE_USERNAME", ""),
			Password: getEnv("DEYE_PASSWORD", ""),
			Region:   getEnv("DEYE_REGION", "eu"),
		},
		Ingecon: IngeconConfig{
			APIKey:  getEnv("INGECON_API_KEY", ""),
			BaseURL: getEnv("INGECON_BASE_URL", "https://www.ingeconsunmonitor.com"),
		},
		Sosen: SosenConfig{
			Username: getEnv("SOSEN_USERNAME", ""),
			Password: getEnv("SOSEN_PASSWORD", ""),
		},

		AdminSeedEmail:    getEnv("ADMIN_SEED_EMAIL", "admin@solarfleet.local"),
		AdminSeedPassword: getEnv("ADMIN_SEED_PASSWORD", "ChangeMe123!"),
		AdminSeedName:     getEnv("ADMIN_SEED_NAME", "Fleet Admin"),

		DaytimeStartHour: getInt("DAYTIME_START_HOUR", 6),
		DaytimeEndHour:   getInt("DAYTIME_END_HOUR", 18),
	}

	// Every reading this platform stores comes from a real inverter portal.
	// With no brand credentials there is nothing to poll, and the dashboard
	// would render an empty fleet that is indistinguishable from a total
	// outage — so refuse to boot and say exactly which vars are missing.
	// A default signing secret in a build that is about to serve real
	// traffic is a silent, total auth bypass for anyone who has read the
	// repository. Refuse to boot rather than warn.
	if cfg.JWTSecret == "change_me_in_production" && cfg.SecureCookies {
		return nil, errors.New("JWT_SECRET is still the placeholder value; set a real secret " +
			"(or set SECURE_COOKIES=false to acknowledge this is a local development run)")
	}

	if !cfg.Deye.Configured() && !cfg.Ingecon.Configured() && !cfg.Sosen.Configured() {
		return nil, errors.New("no inverter credentials configured; set one brand's full credential set: " +
			"DEYE_APP_ID+DEYE_APP_SECRET+DEYE_USERNAME+DEYE_PASSWORD, " +
			"INGECON_API_KEY, or SOSEN_USERNAME+SOSEN_PASSWORD")
	}

	return cfg, nil
}

// KeyPair is one retired signing key, kept only for verification.
type KeyPair struct {
	ID     string
	Secret string
}

// parseKeyring reads "id1:secret1,id2:secret2" into retired signing keys.
//
// Retired keys verify but never sign, which is what lets a secret be
// rotated without logging everyone out: deploy with the new secret active
// and the old one listed here, wait one access-token TTL, then drop it.
func parseKeyring(v string) []KeyPair {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	var out []KeyPair
	for _, entry := range strings.Split(v, ",") {
		id, secret, ok := strings.Cut(strings.TrimSpace(entry), ":")
		if !ok {
			continue
		}
		id, secret = strings.TrimSpace(id), strings.TrimSpace(secret)
		if id == "" || secret == "" {
			continue
		}
		out = append(out, KeyPair{ID: id, Secret: secret})
	}
	return out
}

func getBool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return b
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	i, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return i
}

func getDuration(key string, fallback time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return d
}
