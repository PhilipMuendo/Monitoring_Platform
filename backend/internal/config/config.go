// Package config loads and validates all runtime configuration from
// environment variables exactly once at boot into a typed struct, so
// nothing downstream ever calls os.Getenv directly.
package config

import (
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

type IngeconConfig struct {
	APIKey  string
	BaseURL string
}

type SosenConfig struct {
	Username string
	Password string
}

type Config struct {
	Port              string
	DB                DBConfig
	JWTSecret         string
	JWTAccessTTL      time.Duration
	JWTRefreshTTL     time.Duration
	PollInterval      time.Duration
	LogLevel          string
	UseMockAdapters   bool
	MockSiteCount     int
	CORSAllowedOrigin string

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
		JWTAccessTTL:      getDuration("JWT_ACCESS_TTL", 15*time.Minute),
		JWTRefreshTTL:     getDuration("JWT_REFRESH_TTL", 30*24*time.Hour),
		PollInterval:      getDuration("POLL_INTERVAL", 5*time.Minute),
		LogLevel:          getEnv("LOG_LEVEL", "info"),
		UseMockAdapters:   getBool("USE_MOCK_ADAPTERS", true),
		MockSiteCount:     getInt("MOCK_SITE_COUNT", 50),
		CORSAllowedOrigin: getEnv("CORS_ALLOWED_ORIGIN", "http://localhost:3000"),

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

	if !cfg.UseMockAdapters && cfg.Deye.AppID == "" {
		fmt.Println("warning: USE_MOCK_ADAPTERS=false but DEYE_APP_ID is empty; Deye adapter will fail to authenticate")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
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
