package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"solar-monitor/internal/models"
)

func testUser() *models.User {
	return &models.User{ID: "user-1", Email: "a@b.test", Role: models.RoleTechnician}
}

func mustIssuer(t *testing.T, active SigningKey, previous []SigningKey) *TokenIssuer {
	t.Helper()
	iss, err := NewTokenIssuer(active, previous, 15*time.Minute)
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}
	return iss
}

func TestRoundTripCarriesIdentityAndRole(t *testing.T) {
	iss := mustIssuer(t, SigningKey{ID: "k1", Secret: []byte("secret-one")}, nil)

	token, err := iss.IssueAccessToken(testUser())
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	claims, err := iss.ParseAccessToken(token)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.Subject != "user-1" || claims.Role != models.RoleTechnician {
		t.Errorf("claims = %+v, want subject user-1 role technician", claims)
	}
	if claims.Issuer != tokenIssuer {
		t.Errorf("iss = %q, want %q", claims.Issuer, tokenIssuer)
	}
	if len(claims.Audience) == 0 || claims.Audience[0] != tokenAudience {
		t.Errorf("aud = %v, want %q", claims.Audience, tokenAudience)
	}
	if claims.ID == "" {
		t.Error("jti is empty; a token should be individually identifiable")
	}
}

// The point of the keyring: rotating the signing secret must not log
// everyone out. A token minted under the old key stays valid while that
// key remains listed for verification.
func TestPreviousKeyStillVerifiesAfterRotation(t *testing.T) {
	old := SigningKey{ID: "2026-06", Secret: []byte("old-secret")}
	oldIssuer := mustIssuer(t, old, nil)
	token, err := oldIssuer.IssueAccessToken(testUser())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	rotated := mustIssuer(t, SigningKey{ID: "2026-07", Secret: []byte("new-secret")}, []SigningKey{old})
	if _, err := rotated.ParseAccessToken(token); err != nil {
		t.Fatalf("token minted under the retired key should still verify: %v", err)
	}
}

// ...and once the old key is dropped from the keyring, tokens signed with
// it stop working. That is what makes a leaked secret actually retirable.
func TestDroppedKeyIsRejected(t *testing.T) {
	old := SigningKey{ID: "2026-06", Secret: []byte("old-secret")}
	token, err := mustIssuer(t, old, nil).IssueAccessToken(testUser())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	current := mustIssuer(t, SigningKey{ID: "2026-07", Secret: []byte("new-secret")}, nil)
	if _, err := current.ParseAccessToken(token); err == nil {
		t.Fatal("token signed by a dropped key must be rejected")
	}
}

func TestNewTokensAreSignedByTheActiveKey(t *testing.T) {
	iss := mustIssuer(t, SigningKey{ID: "2026-07", Secret: []byte("new")}, []SigningKey{{ID: "2026-06", Secret: []byte("old")}})
	token, err := iss.IssueAccessToken(testUser())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	parsed, _, err := jwt.NewParser().ParseUnverified(token, &Claims{})
	if err != nil {
		t.Fatalf("parse header: %v", err)
	}
	if kid, _ := parsed.Header[kidHeader].(string); kid != "2026-07" {
		t.Errorf("kid = %q, want the active key 2026-07", kid)
	}
}

// A token from another service that happens to share the secret must not
// be accepted here.
func TestRejectsForeignAudience(t *testing.T) {
	secret := []byte("shared-secret")
	foreign := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user-1",
			Issuer:    "some-other-service",
			Audience:  jwt.ClaimStrings{"some-other-api"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	signed, err := foreign.SignedString(secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	iss := mustIssuer(t, SigningKey{ID: "default", Secret: secret}, nil)
	if _, err := iss.ParseAccessToken(signed); err == nil {
		t.Fatal("a token for a different audience/issuer must be rejected even when the secret matches")
	}
}

// The classic JWT attack: strip the signature and claim alg=none.
func TestRejectsUnsignedToken(t *testing.T) {
	iss := mustIssuer(t, SigningKey{ID: "k", Secret: []byte("secret")}, nil)
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "attacker",
			Issuer:    tokenIssuer,
			Audience:  jwt.ClaimStrings{tokenAudience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}
	if _, err := iss.ParseAccessToken(unsigned); err == nil {
		t.Fatal("alg=none must be rejected")
	}
}

func TestRejectsExpiredToken(t *testing.T) {
	iss, err := NewTokenIssuer(SigningKey{ID: "k", Secret: []byte("secret")}, nil, -time.Minute)
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}
	token, err := iss.IssueAccessToken(testUser())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := iss.ParseAccessToken(token); err == nil {
		t.Fatal("an expired token must be rejected")
	}
}

func TestRefusesEmptySigningKey(t *testing.T) {
	if _, err := NewTokenIssuer(SigningKey{ID: "k"}, nil, time.Minute); err == nil {
		t.Fatal("an empty signing secret must be refused at construction")
	}
}

func TestOpaqueRefreshTokensAreUniqueAndUrlSafe(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		tok, err := GenerateOpaqueToken()
		if err != nil {
			t.Fatalf("GenerateOpaqueToken: %v", err)
		}
		if seen[tok] {
			t.Fatal("duplicate refresh token generated")
		}
		seen[tok] = true
		if strings.ContainsAny(tok, "+/=") {
			t.Errorf("token %q is not URL-safe", tok)
		}
	}
}
