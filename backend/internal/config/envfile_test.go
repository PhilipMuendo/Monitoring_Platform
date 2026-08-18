package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeEnv(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// The rule the whole design rests on: a file on disk must never beat a
// variable the operator actually set. If this ever regresses, a stale
// checked-out .env silently overrides production.
func TestEnvFileNeverOverridesTheEnvironment(t *testing.T) {
	t.Setenv("ENVFILE_ALREADY_SET", "from-environment")

	path := writeEnv(t, "ENVFILE_ALREADY_SET=from-file\nENVFILE_ONLY_IN_FILE=from-file\n")
	applied, err := loadEnvFile(path, true)
	if err != nil {
		t.Fatal(err)
	}

	if got := os.Getenv("ENVFILE_ALREADY_SET"); got != "from-environment" {
		t.Errorf("ENVFILE_ALREADY_SET = %q, want the environment's value to survive", got)
	}
	if got := os.Getenv("ENVFILE_ONLY_IN_FILE"); got != "from-file" {
		t.Errorf("ENVFILE_ONLY_IN_FILE = %q, want it filled from the file", got)
	}
	if applied != 1 {
		t.Errorf("applied = %d, want 1 (the skipped one must not be counted)", applied)
	}
	t.Cleanup(func() { os.Unsetenv("ENVFILE_ONLY_IN_FILE") })
}

// Missing at the default path is normal (containers); missing at a path the
// operator explicitly named is the silent failure this loader exists to end.
func TestMissingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope.env")

	if applied, err := loadEnvFile(missing, false); err != nil || applied != 0 {
		t.Errorf("implicit missing file: applied=%d err=%v, want 0/nil", applied, err)
	}
	if _, err := loadEnvFile(missing, true); err == nil {
		t.Error("explicit ENV_FILE pointing at a missing file must be an error")
	}
}

func TestParsing(t *testing.T) {
	// Deliberately CRLF and BOM-prefixed: this project is developed on
	// Windows, where both arrive by accident via Notepad or Out-File.
	body := "\uFEFFPLAIN=value\r\n" +
		"\r\n" +
		"# a comment\r\n" +
		"  SPACED  =  padded  \r\n" +
		"export EXPORTED=yes\r\n" +
		`DQUOTED="a b # c"` + "\r\n" +
		`SQUOTED='raw \n stays'` + "\r\n" +
		`ESCAPED="line1\nline2"` + "\r\n" +
		"TRAILING_COMMENT=5m # five minutes\r\n" +
		"HASH_IN_VALUE=pa#ssword\r\n" +
		"EMPTY=\r\n" +
		"URL=postgres://u:p@h:5432/db?sslmode=disable\r\n"

	path := writeEnv(t, body)
	if _, err := loadEnvFile(path, true); err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"PLAIN":            "value",
		"SPACED":           "padded",
		"EXPORTED":         "yes",
		"DQUOTED":          "a b # c",
		"SQUOTED":          `raw \n stays`,
		"ESCAPED":          "line1\nline2",
		"TRAILING_COMMENT": "5m",
		// A # with no space before it is part of the value. These files hold
		// vendor portal passwords; truncating one at a # would be a silent
		// authentication failure against a third party.
		"HASH_IN_VALUE": "pa#ssword",
		"EMPTY":         "",
		// The = inside a connection string must not split the line twice.
		"URL": "postgres://u:p@h:5432/db?sslmode=disable",
	}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
		t.Cleanup(func() { os.Unsetenv(k) })
	}
}

// A line that cannot be parsed must name itself, not be skipped. Losing one
// key quietly is exactly the cost this package is paying to avoid.
func TestMalformedLinesAreLoud(t *testing.T) {
	cases := map[string]string{
		"no equals sign":   "GOOD=1\nthis is not an assignment\n",
		"invalid key":      "GOOD=1\nBAD-KEY=2\n",
		"key starts digit": "1BAD=2\n",
		"bad escape":       `X="oops \q"` + "\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := loadEnvFile(writeEnv(t, body), true); err == nil {
				t.Error("want an error naming the offending line, got nil")
			}
		})
	}
}
