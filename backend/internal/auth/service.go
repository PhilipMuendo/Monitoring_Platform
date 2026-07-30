package auth

import (
	"context"
	"errors"
	"time"

	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrAccountDisabled    = errors.New("account disabled")
	ErrInvalidToken       = errors.New("invalid or expired refresh token")
)

type Service struct {
	users         *storage.UserRepo
	refreshTokens *storage.RefreshTokenRepo
	issuer        *TokenIssuer
	refreshTTL    time.Duration
}

func NewService(users *storage.UserRepo, refreshTokens *storage.RefreshTokenRepo, issuer *TokenIssuer, refreshTTL time.Duration) *Service {
	return &Service{users: users, refreshTokens: refreshTokens, issuer: issuer, refreshTTL: refreshTTL}
}

type Result struct {
	User         *models.User
	AccessToken  string
	RefreshToken string
}

func (s *Service) Login(ctx context.Context, email, password string) (*Result, error) {
	user, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			// Run the same bcrypt work a real check would incur, so a
			// nonexistent account isn't distinguishable from a wrong
			// password by response time.
			CheckPassword(dummyHash, password)
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if !user.IsActive {
		return nil, ErrAccountDisabled
	}
	if !CheckPassword(user.PasswordHash, password) {
		return nil, ErrInvalidCredentials
	}

	result, err := s.issueTokens(ctx, user)
	if err != nil {
		return nil, err
	}
	_ = s.users.TouchLastLogin(ctx, user.ID)
	return result, nil
}

// Refresh rotates the refresh token: the old one is revoked and a new
// pair is issued, so a stolen-but-unused refresh token has a single
// use before it stops working.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (*Result, error) {
	userID, err := s.refreshTokens.Validate(ctx, refreshToken)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return nil, ErrInvalidToken
		}
		return nil, err
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive {
		return nil, ErrAccountDisabled
	}

	_ = s.refreshTokens.Revoke(ctx, refreshToken)
	return s.issueTokens(ctx, user)
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	return s.refreshTokens.Revoke(ctx, refreshToken)
}

func (s *Service) issueTokens(ctx context.Context, user *models.User) (*Result, error) {
	access, err := s.issuer.IssueAccessToken(user)
	if err != nil {
		return nil, err
	}
	refresh, err := GenerateOpaqueToken()
	if err != nil {
		return nil, err
	}
	if err := s.refreshTokens.Store(ctx, user.ID, refresh, time.Now().Add(s.refreshTTL)); err != nil {
		return nil, err
	}
	return &Result{User: user, AccessToken: access, RefreshToken: refresh}, nil
}

// EnsureSeedAdmin creates the default admin account on first boot if the
// users table is empty, so there's always a way to log in.
func EnsureSeedAdmin(ctx context.Context, users *storage.UserRepo, email, password, name string) error {
	count, err := users.Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	_, err = users.Create(ctx, email, hash, name, models.RoleAdmin)
	return err
}
