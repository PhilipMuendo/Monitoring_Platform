// Command server is the solar-monitor backend: a single binary running
// the REST/SSE API and the 5-minute polling+alerting engine side by side.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"solar-monitor/internal/adapters/deye"
	"solar-monitor/internal/adapters/ingecon"
	"solar-monitor/internal/adapters/mock"
	"solar-monitor/internal/adapters/sosen"
	"solar-monitor/internal/alertengine"
	"solar-monitor/internal/api"
	"solar-monitor/internal/auth"
	"solar-monitor/internal/collector"
	"solar-monitor/internal/config"
	"solar-monitor/internal/logger"
	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	log := logger.New(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := storage.Connect(ctx, cfg.DB)
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
	metrics := storage.NewMetricsRepo(db)
	alertsRepo := storage.NewAlertRepo(db)
	users := storage.NewUserRepo(db)
	refreshTokens := storage.NewRefreshTokenRepo(db)
	auditRepo := storage.NewAuditRepo(db)

	if err := auth.EnsureSeedAdmin(ctx, users, cfg.AdminSeedEmail, cfg.AdminSeedPassword, cfg.AdminSeedName); err != nil {
		log.Error("failed to seed admin user", "error", err)
		os.Exit(1)
	}

	sseHub := api.NewSSEHub()

	alertCfg := alertengine.DefaultConfig()
	alertCfg.DaytimeStartHour = cfg.DaytimeStartHour
	alertCfg.DaytimeEndMinutes = cfg.DaytimeEndHour*60 + 30
	engine := alertengine.New(alertsRepo, metrics, alertCfg).WithNotifier(sseHub)

	brandAdapters := buildAdapters(cfg)
	coll := collector.New(brandAdapters, sites, metrics, engine, cfg.PollInterval)
	go coll.Run(ctx)

	tokenIssuer := auth.NewTokenIssuer(cfg.JWTSecret, cfg.JWTAccessTTL)
	authService := auth.NewService(users, refreshTokens, tokenIssuer, cfg.JWTRefreshTTL)

	router := api.NewRouter(&api.Deps{
		Cfg:         cfg,
		Sites:       sites,
		Metrics:     metrics,
		Alerts:      alertsRepo,
		Users:       users,
		Audit:       auditRepo,
		AuthService: authService,
		TokenIssuer: tokenIssuer,
		Collector:   coll,
		SSEHub:      sseHub,
		StartedAt:   time.Now(),
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE connections are long-lived
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Info("server listening", "port", cfg.Port, "mock_adapters", cfg.UseMockAdapters)
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

// buildAdapters wires either the mock demo adapters (default) or the
// real brand adapters, one models.BrandAdapter per brand either way — the
// collector never knows the difference.
func buildAdapters(cfg *config.Config) []models.BrandAdapter {
	if cfg.UseMockAdapters {
		slog.Info("using mock brand adapters for demo data", "site_count", cfg.MockSiteCount)
		perBrand := cfg.MockSiteCount / 3
		remainder := cfg.MockSiteCount % 3
		counts := [3]int{perBrand, perBrand, perBrand}
		for i := 0; i < remainder; i++ {
			counts[i]++
		}
		return []models.BrandAdapter{
			mock.New(models.BrandDeye, counts[0], 0),
			mock.New(models.BrandIngecon, counts[1], counts[0]),
			mock.New(models.BrandSosen, counts[2], counts[0]+counts[1]),
		}
	}

	return []models.BrandAdapter{
		deye.New(cfg.Deye),
		ingecon.New(cfg.Ingecon),
		sosen.New(cfg.Sosen),
	}
}

func getEnvOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
