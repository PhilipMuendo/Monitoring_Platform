// Command server is the solar-monitor backend: a single binary running
// the REST/SSE API and the polling+alerting engine side by side.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"solar-monitor/internal/adapters"
	"solar-monitor/internal/adapters/deye"
	"solar-monitor/internal/adapters/gemini"
	"solar-monitor/internal/adapters/httpjson"
	"solar-monitor/internal/adapters/ingecon"
	"solar-monitor/internal/adapters/sosen"
	"solar-monitor/internal/alertengine"
	"solar-monitor/internal/api"
	"solar-monitor/internal/auth"
	"solar-monitor/internal/collector"
	"solar-monitor/internal/config"
	"solar-monitor/internal/logger"
	"solar-monitor/internal/models"
	"solar-monitor/internal/observability"
	"solar-monitor/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		// The logger isn't built yet (its level comes from cfg), and a
		// configuration error is an operator mistake, not a crash — print
		// it plainly rather than dumping a panic stack.
		fmt.Fprintln(os.Stderr, "configuration error:", err)
		os.Exit(1)
	}
	log := logger.New(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	metrics := observability.NewMetrics()

	db, err := storage.Connect(ctx, cfg.DB, cfg.DBMaxConns)
	if err != nil {
		log.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	migrationsDir := getEnvOr("MIGRATIONS_PATH", "./migrations")
	if err := storage.Migrate(ctx, db, migrationsDir); err != nil {
		log.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	sites := storage.NewSiteRepo(db)
	siteMetrics := storage.NewMetricsRepo(db)
	readings := storage.NewReadingStore(db)
	alertsRepo := storage.NewAlertRepo(db)
	users := storage.NewUserRepo(db)
	refreshTokens := storage.NewRefreshTokenRepo(db)
	auditRepo := storage.NewAuditRepo(db)

	if err := auth.EnsureSeedAdmin(ctx, users, cfg.AdminSeedEmail, cfg.AdminSeedPassword, cfg.AdminSeedName); err != nil {
		log.Error("failed to seed admin user", "error", err)
		os.Exit(1)
	}

	sseHub := api.NewSSEHub()

	var geminiClient *gemini.Client
	if cfg.ChatEnabled() {
		geminiClient = gemini.New(cfg.GeminiAPIKey, cfg.GeminiModel, httpjson.Hooks{OnAttempt: metrics.ObserveAdapterAttempt})
		log.Info("ai chat enabled", "model", cfg.GeminiModel)
	}

	alertCfg := alertengine.DefaultConfig()
	alertCfg.DaytimeStartHour = cfg.DaytimeStartHour
	alertCfg.DaytimeEndMinutes = cfg.DaytimeEndHour*60 + 30
	engine := alertengine.New(alertsRepo, siteMetrics, alertCfg).
		WithNotifier(sseHub).
		WithMetrics(metrics)

	brandAdapters := buildAdapters(cfg, log, metrics)
	coll := collector.New(brandAdapters, sites, readings, engine, collector.Options{
		PollInterval:   cfg.PollInterval,
		MaxConcurrency: cfg.MaxConcurrency,
		CycleTimeout:   cfg.CollectorTimeout,
		Metrics:        metrics,
	})

	// History accumulates from live polling only. A fresh database starts
	// with empty charts and fills in one poll interval at a time — there is
	// no seeding step, because anything we could seed would be invented
	// rather than measured.
	go coll.Run(ctx)
	go runTokenPruner(ctx, refreshTokens, log)

	tokenIssuer, err := auth.NewTokenIssuer(
		auth.SigningKey{ID: cfg.JWTKeyID, Secret: []byte(cfg.JWTSecret)},
		previousKeys(cfg),
		cfg.JWTAccessTTL,
	)
	if err != nil {
		log.Error("failed to build token issuer", "error", err)
		os.Exit(1)
	}
	authService := auth.NewService(users, refreshTokens, tokenIssuer, cfg.JWTRefreshTTL)

	router := api.NewRouter(&api.Deps{
		Cfg:         cfg,
		DB:          db,
		Sites:       sites,
		SiteMetrics: siteMetrics,
		Alerts:      alertsRepo,
		Users:       users,
		Audit:       auditRepo,
		AuthService: authService,
		TokenIssuer: tokenIssuer,
		LoginThrottle: auth.NewThrottle(auth.ThrottleConfig{
			MaxFailures: cfg.LoginMaxFailures,
			Window:      cfg.LoginWindow,
			Lockout:     cfg.LoginLockout,
		}),
		Collector:   coll,
		Metrics:     metrics,
		SSEHub:      sseHub,
		Gemini:      geminiClient,
		ChatLimiter: api.NewChatLimiter(),
		Describers:  describers(brandAdapters),
		StartedAt:   time.Now(),
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE connections are long-lived
		IdleTimeout:  60 * time.Second,
		// Without a header timeout a slowloris client can hold connections
		// open indefinitely, since ReadTimeout alone doesn't bound the
		// header phase for an idle-but-connected peer.
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("server listening", "port", cfg.Port, "metrics", cfg.MetricsEnabled)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("graceful shutdown failed", "error", err)
	}
}

// buildAdapters registers one models.BrandAdapter per brand that has
// credentials in the environment. Unconfigured brands are skipped rather
// than registered: an adapter with no credentials can only fail its
// FetchAll every cycle, which inflates the error count and buries genuine
// portal outages in noise. config.Load has already guaranteed at least one
// brand is configured, so this never returns an empty slice.
func buildAdapters(cfg *config.Config, log *slog.Logger, metrics *observability.Metrics) []models.BrandAdapter {
	// Every vendor HTTP attempt — including retries — is observed here, so
	// the adapters never import the metrics package.
	hooks := httpjson.Hooks{OnAttempt: metrics.ObserveAdapterAttempt}

	// COLLECTOR_MAX_CONCURRENCY is applied HERE, to the per-site vendor
	// requests, which is what it has always claimed to bound. Until now it
	// only bounded the database fan-out that follows FetchAll, so the knob an
	// operator would reach for to speed up collection had no effect on the
	// part of the cycle that actually takes the time.
	var out []models.BrandAdapter
	if cfg.Deye.Configured() {
		out = append(out, deye.New(cfg.Deye, hooks).WithConcurrency(cfg.MaxConcurrency))
	}
	if cfg.Ingecon.Configured() {
		out = append(out, ingecon.New(cfg.Ingecon, hooks).WithConcurrency(cfg.MaxConcurrency))
	}
	if cfg.Sosen.Configured() {
		out = append(out, sosen.New(cfg.Sosen, hooks).WithConcurrency(cfg.MaxConcurrency))
	}

	brands := make([]string, len(out))
	for i, a := range out {
		brands[i] = a.Name()
	}
	log.Info("brand adapters registered", "brands", brands)
	return out
}

// describers indexes the adapters that can enumerate their own plants, so
// the admin API can validate a hand-entered brand_site_id before creating
// a site that could never receive telemetry.
func describers(list []models.BrandAdapter) map[models.Brand]adapters.SiteDescriber {
	out := make(map[models.Brand]adapters.SiteDescriber, len(list))
	for _, a := range list {
		if d, ok := a.(adapters.SiteDescriber); ok {
			out[models.Brand(a.Name())] = d
		}
	}
	return out
}

func previousKeys(cfg *config.Config) []auth.SigningKey {
	out := make([]auth.SigningKey, 0, len(cfg.JWTPreviousKeys))
	for _, k := range cfg.JWTPreviousKeys {
		out = append(out, auth.SigningKey{ID: k.ID, Secret: []byte(k.Secret)})
	}
	return out
}

// runTokenPruner periodically deletes expired/long-revoked refresh
// tokens. Runs once at boot (so a long-lived deployment doesn't wait a
// full interval to start cleaning up) and every tokenPruneInterval after.
const tokenPruneInterval = 6 * time.Hour

func runTokenPruner(ctx context.Context, tokens *storage.RefreshTokenRepo, log *slog.Logger) {
	prune := func() {
		n, err := tokens.PruneExpired(ctx)
		if err != nil {
			log.Warn("refresh token prune failed", "error", err)
			return
		}
		if n > 0 {
			log.Info("pruned expired refresh tokens", "count", n)
		}
	}

	prune()

	ticker := time.NewTicker(tokenPruneInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			prune()
		}
	}
}

func getEnvOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
