package config

import (
	"testing"
	"time"
)

// A default signing secret in a build about to serve real traffic is a
// total auth bypass for anyone who has read the repository. Boot must fail.
func TestRefusesPlaceholderJWTSecretInProduction(t *testing.T) {
	t.Setenv("JWT_SECRET", "change_me_in_production")
	t.Setenv("SECURE_COOKIES", "true")
	t.Setenv("DEYE_APP_ID", "id")
	t.Setenv("DEYE_APP_SECRET", "secret")
	t.Setenv("DEYE_USERNAME", "user")
	t.Setenv("DEYE_PASSWORD", "pass")

	if _, err := Load(); err == nil {
		t.Fatal("expected Load to refuse the placeholder JWT secret")
	}
}

// ...but a local development run, which has explicitly opted out of secure
// cookies, is allowed to keep the placeholder.
func TestAllowsPlaceholderSecretForLocalDevelopment(t *testing.T) {
	t.Setenv("JWT_SECRET", "change_me_in_production")
	t.Setenv("SECURE_COOKIES", "false")
	t.Setenv("INGECON_API_KEY", "key")

	if _, err := Load(); err != nil {
		t.Fatalf("local development run should be allowed: %v", err)
	}
}

func TestRefusesWhenNoBrandIsConfigured(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-secret")
	for _, k := range []string{
		"DEYE_APP_ID", "DEYE_APP_SECRET", "DEYE_USERNAME", "DEYE_PASSWORD",
		"INGECON_API_KEY", "SOSEN_USERNAME", "SOSEN_PASSWORD",
	} {
		t.Setenv(k, "")
	}

	if _, err := Load(); err == nil {
		t.Fatal("expected Load to refuse a build with no inverter credentials")
	}
}

// A half-filled credential set is "not integrated", not "integrated and
// broken" — registering it would fail every cycle and drown real outages.
func TestPartialDeyeCredentialsAreNotConfigured(t *testing.T) {
	cfg := DeyeConfig{AppID: "id", Secret: "secret", Username: "user"} // no password
	if cfg.Configured() {
		t.Error("Deye with a missing password must not count as configured")
	}
	cfg.Password = "pass"
	if !cfg.Configured() {
		t.Error("a complete Deye credential set should be configured")
	}
}

func TestSosenAndIngeconConfigured(t *testing.T) {
	if (SosenConfig{Username: "u"}).Configured() {
		t.Error("Sosen without a password must not count as configured")
	}
	if !(SosenConfig{Username: "u", Password: "p"}).Configured() {
		t.Error("a complete Sosen credential set should be configured")
	}
	if (IngeconConfig{}).Configured() {
		t.Error("Ingecon without an API key must not count as configured")
	}
	if !(IngeconConfig{APIKey: "k"}).Configured() {
		t.Error("Ingecon with an API key should be configured")
	}
}

func TestParseKeyring(t *testing.T) {
	got := parseKeyring(" 2026-06:old-secret , 2026-05:older-secret ")
	if len(got) != 2 {
		t.Fatalf("parsed %d keys, want 2: %+v", len(got), got)
	}
	if got[0].ID != "2026-06" || got[0].Secret != "old-secret" {
		t.Errorf("first key = %+v, want id 2026-06 / old-secret (whitespace trimmed)", got[0])
	}
}

func TestParseKeyringSkipsMalformedEntries(t *testing.T) {
	cases := map[string]string{
		"empty":           "",
		"no colon":        "justanid",
		"missing secret":  "id:",
		"missing id":      ":secret",
		"whitespace only": "   ",
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if got := parseKeyring(in); len(got) != 0 {
				t.Errorf("parseKeyring(%q) = %+v, want nothing", in, got)
			}
		})
	}
}

func TestDurationAndIntFallbacks(t *testing.T) {
	t.Setenv("SOME_DURATION", "not-a-duration")
	if got := getDuration("SOME_DURATION", 5*time.Minute); got != 5*time.Minute {
		t.Errorf("unparseable duration = %v, want the fallback", got)
	}
	t.Setenv("SOME_INT", "not-an-int")
	if got := getInt("SOME_INT", 7); got != 7 {
		t.Errorf("unparseable int = %v, want the fallback", got)
	}
	t.Setenv("SOME_BOOL", "not-a-bool")
	if got := getBool("SOME_BOOL", true); !got {
		t.Error("unparseable bool should fall back")
	}
}

// SECURE_COOKIES must default to on: getting this wrong in the safe
// direction only breaks localhost, whereas the unsafe direction ships a
// session cookie over plaintext.
func TestSecureCookiesDefaultsOn(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-secret")
	t.Setenv("INGECON_API_KEY", "key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.SecureCookies {
		t.Error("SecureCookies should default to true")
	}
}
