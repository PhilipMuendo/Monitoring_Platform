package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// The .env loader.
//
// WHY THIS EXISTS. Every value in this service arrives through os.Getenv, and
// for a container or a systemd unit that is exactly right — the orchestrator
// owns the environment. But `backend/.env` has existed in this repo since the
// beginning and was read by absolutely nothing: no dotenv dependency, and no
// `env_file:` directive in docker-compose.yml. Anyone running the binary
// natively edited that file, saw no effect, and got a symptom far from the
// cause — the AI chat replying "unavailable" because GEMINI_API_KEY never
// reached the process, and before that a boot failure on the placeholder
// JWT_SECRET. A config file that looks authoritative and is inert is worse
// than no config file at all.
//
// THE RULES, and why each one is not negotiable:
//
//  1. A variable already present in the environment is NEVER overwritten.
//     The file is the lowest-priority source, below Compose, systemd, CI and
//     the shell. Otherwise a stale checked-out .env would quietly beat the
//     production environment — a file that only exists on disk must never
//     outrank the one the operator deliberately set.
//
//  2. A missing file at the DEFAULT path is not an error. Containers have no
//     .env and must boot from their environment alone.
//
//  3. A missing file at an EXPLICITLY REQUESTED path (ENV_FILE=...) IS an
//     error. Asking for a specific file and silently getting none is the
//     same silent failure this loader was written to end.
//
//  4. A malformed line is an error naming the line number, not a skip.
//     Same reasoning: losing one key quietly is the expensive failure.
//
// This is deliberately not github.com/joho/godotenv. The parser is ~60 lines,
// this module has five direct dependencies and all five are load-bearing, and
// rules 1/3/4 above are stricter than godotenv's defaults — we would be
// wrapping it to get them anyway.

// defaultEnvFile is resolved relative to the process working directory. Run
// from backend/ (which `go run ./cmd/server` does) it finds backend/.env; run
// inside the container from /app it finds nothing and no-ops.
const defaultEnvFile = ".env"

// loadEnvFile applies KEY=VALUE pairs from path into the process environment
// without overwriting anything already set. It reports the number of
// variables it actually applied.
func loadEnvFile(path string, explicit bool) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) && !explicit {
			return 0, nil // rule 2
		}
		return 0, fmt.Errorf("env file %s: %w", path, err) // rule 3
	}
	defer f.Close()

	applied := 0
	sc := bufio.NewScanner(f)
	for line := 1; sc.Scan(); line++ {
		text := sc.Text()
		if line == 1 {
			// Notepad and PowerShell's Out-File write a UTF-8 BOM. Left in
			// place it becomes part of the first key name, so PORT silently
			// becomes "\uFEFFPORT" and is never read. This project is
			// developed on Windows; that is a matter of when, not if.
			text = strings.TrimPrefix(text, "\uFEFF")
		}
		text = strings.TrimSpace(text) // also drops the \r of a CRLF file

		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		text = strings.TrimPrefix(text, "export ")

		key, rawValue, found := strings.Cut(text, "=")
		if !found {
			return applied, fmt.Errorf("env file %s line %d: expected KEY=VALUE, got %q", path, line, text)
		}
		key = strings.TrimSpace(key)
		if !validKey(key) {
			return applied, fmt.Errorf("env file %s line %d: %q is not a valid variable name", path, line, key)
		}

		value, err := parseValue(rawValue)
		if err != nil {
			return applied, fmt.Errorf("env file %s line %d (%s): %w", path, line, key, err)
		}

		if _, exists := os.LookupEnv(key); exists {
			continue // rule 1
		}
		if err := os.Setenv(key, value); err != nil {
			return applied, fmt.Errorf("env file %s line %d (%s): %w", path, line, key, err)
		}
		applied++
	}
	if err := sc.Err(); err != nil {
		return applied, fmt.Errorf("env file %s: %w", path, err)
	}
	return applied, nil
}

func validKey(k string) bool {
	if k == "" {
		return false
	}
	for i, r := range k {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '_':
		case r >= '0' && r <= '9' && i > 0:
		default:
			return false
		}
	}
	return true
}

// parseValue handles the three quoting forms.
//
// Unquoted values have a whitespace-preceded # treated as a trailing comment,
// which is what every dotenv implementation does and what `POLL_INTERVAL=5m
// # five minutes` needs. Note the asymmetry that protects secrets: a # with
// no space before it is kept, so a password like abc#def survives unquoted.
// Only `abc #def` would be truncated — and the .env.example says to quote
// values containing #, precisely because these files hold portal passwords.
func parseValue(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if len(v) >= 2 {
		if q := v[0]; (q == '"' || q == '\'') && v[len(v)-1] == q {
			inner := v[1 : len(v)-1]
			if q == '\'' {
				return inner, nil // single quotes are literal
			}
			return unescape(inner)
		}
	}
	if i := strings.Index(v, " #"); i >= 0 {
		v = strings.TrimSpace(v[:i])
	}
	if i := strings.Index(v, "\t#"); i >= 0 {
		v = strings.TrimSpace(v[:i])
	}
	return v, nil
}

func unescape(s string) (string, error) {
	if !strings.Contains(s, `\`) {
		return s, nil
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			b.WriteByte(s[i])
			continue
		}
		i++
		if i >= len(s) {
			return "", fmt.Errorf(`value ends with a dangling \`)
		}
		switch s[i] {
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		case '\\':
			b.WriteByte('\\')
		case '"':
			b.WriteByte('"')
		default:
			return "", fmt.Errorf(`unknown escape \%c`, s[i])
		}
	}
	return b.String(), nil
}
