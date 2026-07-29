package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"solar-monitor/internal/models"
)

const (
	// tokenIssuer and tokenAudience pin who minted a token and what it is
	// for. Without them any HS256 token signed with the same secret is
	// accepted — including one minted by a different service that happens
	// to share the secret, or one intended as a different token type. They
	// cost nothing and close a whole class of confusion.
	tokenIssuer   = "solar-monitor"
	tokenAudience = "solar-monitor-api"

	// kidHeader names the key that signed a token, which is what makes
	// rotation possible at all.
	kidHeader = "kid"
)

var (
	ErrNoSigningKey = errors.New("auth: no active signing key configured")
	ErrUnknownKeyID = errors.New("auth: token signed by an unknown key")
)

type Claims struct {
	Email string      `json:"email"`
	Role  models.Role `json:"role"`
	jwt.RegisteredClaims
}

// SigningKey is one entry in the keyring.
type SigningKey struct {
	// ID appears in the token header so a verifier knows which secret to
	// try. Keep it short and stable, e.g. "2026-07".
	ID     string
	Secret []byte
}

// TokenIssuer signs with the active key and verifies against the whole
// keyring.
//
// Rotation was previously impossible: a single static secret meant that
// changing JWT_SECRET invalidated every live session instantly, so in
// practice nobody ever rotated it. With a keyring you publish the new key
// alongside the old, start signing with the new one, and drop the old once
// the access-token TTL has elapsed — nobody is logged out, and a leaked
// secret can actually be retired.
type TokenIssuer struct {
	active    SigningKey
	verifiers map[string][]byte
	accessTTL time.Duration
}

// NewTokenIssuer builds an issuer. `active` signs new tokens; `previous`
// keys are accepted for verification only, covering the rotation window.
func NewTokenIssuer(active SigningKey, previous []SigningKey, accessTTL time.Duration) (*TokenIssuer, error) {
	if len(active.Secret) == 0 {
		return nil, ErrNoSigningKey
	}
	if active.ID == "" {
		active.ID = "default"
	}
	verifiers := map[string][]byte{active.ID: active.Secret}
	for _, k := range previous {
		if k.ID == "" || len(k.Secret) == 0 || k.ID == active.ID {
			continue
		}
		verifiers[k.ID] = k.Secret
	}
	return &TokenIssuer{active: active, verifiers: verifiers, accessTTL: accessTTL}, nil
}

func (t *TokenIssuer) IssueAccessToken(u *models.User) (string, error) {
	now := time.Now()
	claims := Claims{
		Email: u.Email,
		Role:  u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   u.ID,
			Issuer:    tokenIssuer,
			Audience:  jwt.ClaimStrings{tokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.accessTTL)),
			ID:        randomID(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header[kidHeader] = t.active.ID
	return token.SignedString(t.active.Secret)
}

func (t *TokenIssuer) ParseAccessToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims,
		func(tok *jwt.Token) (any, error) {
			// Pinning the algorithm is what stops the classic "alg: none"
			// and RS256->HS256 key-confusion attacks.
			if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", tok.Header["alg"])
			}
			kid, _ := tok.Header[kidHeader].(string)
			if kid == "" {
				// Tokens minted before rotation existed carry no kid. They
				// verify against the active key only, so they age out
				// naturally within one access TTL.
				return t.active.Secret, nil
			}
			secret, ok := t.verifiers[kid]
			if !ok {
				return nil, ErrUnknownKeyID
			}
			return secret, nil
		},
		jwt.WithIssuer(tokenIssuer),
		jwt.WithAudience(tokenAudience),
		jwt.WithExpirationRequired(),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

// GenerateOpaqueToken creates a cryptographically random refresh token.
// Deliberately not a JWT: revoking a signed token is impossible short of
// a blocklist, whereas an opaque token's validity lives entirely in the
// refresh_tokens table and can be revoked by deleting/flagging one row.
func GenerateOpaqueToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// randomID gives each access token a unique jti, so a specific token can
// be identified in logs (and blocklisted later if that is ever needed)
// without inspecting its whole payload.
func randomID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
