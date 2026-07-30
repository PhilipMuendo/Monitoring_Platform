// Package storage is the only part of the backend that speaks SQL. Every
// other package (collector, alerts, api) goes through the repository
// types defined here (SiteRepo, MetricsRepo, AlertRepo, UserRepo).
package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"solar-monitor/internal/config"
)

type DB struct {
	Pool *pgxpool.Pool
}

// maxConns bounds the pool. Callers pass config.Config.DBMaxConns, which
// Load derives from the collector's own concurrency rather than a static
// guess — see the comment there.
func Connect(ctx context.Context, cfg config.DBConfig, maxConns int) (*DB, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}
	if maxConns <= 0 {
		maxConns = 20
	}
	poolCfg.MaxConns = int32(maxConns)
	poolCfg.MinConns = 2
	poolCfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create db pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return &DB{Pool: pool}, nil
}

func (d *DB) Close() {
	d.Pool.Close()
}
