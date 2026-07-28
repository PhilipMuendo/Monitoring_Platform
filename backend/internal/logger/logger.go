// Package logger configures the application-wide structured JSON logger
// (stdlib log/slog — no external dependency needed).
package logger

import (
	"log/slog"
	"os"
	"strings"
)

// New builds a JSON slog.Logger at the given level ("debug"|"info"|"warn"|"error").
func New(level string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})
	l := slog.New(handler)
	slog.SetDefault(l)
	return l
}
