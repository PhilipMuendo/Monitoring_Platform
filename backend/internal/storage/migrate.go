package storage

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
)

// Migrate applies every .sql file in dir, in filename order, tracking
// what's already been applied in schema_migrations so re-running on
// every boot is safe and cheap. Migrations are also written to be
// idempotent (IF NOT EXISTS / if_not_exists=>TRUE) as a second line of
// defense — this matters because docker-compose's Postgres image already
// auto-runs the same files via docker-entrypoint-initdb.d on first
// volume creation, so the app frequently boots against a DB that's
// already up to date.
// migrationLockID is an arbitrary but stable key for pg_advisory_lock.
// Any constant works as long as nothing else in the database picks the
// same one; it is derived from "solar-monitor migrations" so a collision
// with another application sharing the cluster is vanishingly unlikely.
const migrationLockID int64 = 0x50C4_3EED_0001

func Migrate(ctx context.Context, db *DB, dir string) error {
	// Serialize migrations across processes.
	//
	// Without this, two backend replicas booting together both observe an
	// empty schema_migrations and both run the DDL. The bookkeeping insert
	// is ON CONFLICT DO NOTHING so it survives, but the migration *body*
	// executes twice — fine for the IF NOT EXISTS statements we happen to
	// have today, and silently destructive the first time someone writes a
	// migration that isn't idempotent. This was the single thing blocking
	// horizontal scaling of the backend.
	//
	// A session-level advisory lock is the right tool: it is held by the
	// connection, released explicitly below, and released automatically by
	// Postgres if the process dies mid-migration rather than wedging every
	// future boot.
	conn, err := db.Pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationLockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		// Best-effort: a failure here only matters if the connection also
		// survives, and Postgres drops session locks when it doesn't.
		if _, err := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, migrationLockID); err != nil {
			slog.Warn("failed to release migration lock", "error", err)
		}
	}()

	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir %q: %w", dir, err)
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".sql" {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	for _, name := range files {
		var already bool
		if err := conn.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename = $1)`, name,
		).Scan(&already); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if already {
			continue
		}

		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		slog.Info("applying migration", "file", name)
		if _, err := conn.Exec(ctx, string(content)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}

		if _, err := conn.Exec(ctx,
			`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, name,
		); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
	}

	return nil
}
