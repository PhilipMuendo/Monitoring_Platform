package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"solar-monitor/internal/models"
)

type UserRepo struct{ db *DB }

func NewUserRepo(db *DB) *UserRepo { return &UserRepo{db: db} }

const userSelect = `SELECT id::text, email, password_hash, name, role, is_active, created_at FROM users`

func scanUser(row pgx.Row) (models.User, error) {
	var u models.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive, &u.CreatedAt)
	return u, err
}

func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	row := r.db.Pool.QueryRow(ctx, userSelect+` WHERE lower(email) = lower($1)`, email)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepo) GetByID(ctx context.Context, id string) (*models.User, error) {
	row := r.db.Pool.QueryRow(ctx, userSelect+` WHERE id = $1::uuid`, id)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepo) Count(ctx context.Context) (int, error) {
	var n int
	err := r.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (r *UserRepo) Create(ctx context.Context, email, passwordHash, name string, role models.Role) (*models.User, error) {
	row := r.db.Pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, email, password_hash, name, role, is_active, created_at
	`, email, passwordHash, name, string(role))
	u, err := scanUser(row)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	return &u, nil
}

func (r *UserRepo) List(ctx context.Context) ([]models.User, error) {
	rows, err := r.db.Pool.Query(ctx, userSelect+` ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Non-nil so the admin users list serializes as [], not null.
	out := []models.User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *UserRepo) TouchLastLogin(ctx context.Context, id string) error {
	_, err := r.db.Pool.Exec(ctx, `UPDATE users SET last_login_at = NOW() WHERE id = $1::uuid`, id)
	return err
}

// --- refresh tokens ---------------------------------------------------

type RefreshTokenRepo struct{ db *DB }

func NewRefreshTokenRepo(db *DB) *RefreshTokenRepo { return &RefreshTokenRepo{db: db} }

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r *RefreshTokenRepo) Store(ctx context.Context, userID, token string, expiresAt time.Time) error {
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)
	`, userID, hashToken(token), expiresAt)
	return err
}

// Validate returns the user_id for a still-valid, unrevoked refresh
// token, or ErrNotFound.
func (r *RefreshTokenRepo) Validate(ctx context.Context, token string) (string, error) {
	var userID string
	err := r.db.Pool.QueryRow(ctx, `
		SELECT user_id::text FROM refresh_tokens
		WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
	`, hashToken(token)).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return userID, nil
}

func (r *RefreshTokenRepo) Revoke(ctx context.Context, token string) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, hashToken(token))
	return err
}

// PruneExpired deletes refresh tokens that can no longer be used: expired
// outright, or revoked more than a day ago (the grace window is only so a
// recent rotation is still visible if anyone needs to check, not because
// the token still works). Rotation on Refresh leaves the old row behind
// revoked rather than deleting it, and nothing else in the normal
// login/refresh path ever removes a row, so without this the table grows
// forever.
func (r *RefreshTokenRepo) PruneExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Pool.Exec(ctx, `
		DELETE FROM refresh_tokens
		WHERE expires_at < NOW() OR revoked_at < NOW() - INTERVAL '1 day'
	`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
