package storage

import (
	"regexp"
	"strings"
	"testing"
)

// Regression guard for a bug that shipped and reached a running server.
//
// alertSettingsColumns is concatenated between SQL keywords, and it originally
// had no trailing newline, so `SELECT`+columns+`FROM alert_settings` produced
// "updated_byFROM alert_settings" — a valid-looking query with no FROM clause,
// which Postgres rejected with `column "production_drop_threshold_w" does not
// exist`. The reported column was not even the broken one, which is what made
// it expensive: with no table in scope the FIRST column is simply the first
// name that fails to resolve.
//
// Nothing caught it, because every test in this package is DB-free and the
// query text was only ever assembled at call time. Asserting on the assembled
// string costs nothing and closes exactly that gap.
func TestLoadSQLIsWellFormed(t *testing.T) {
	sql := loadAlertSettingsSQL

	// The specific failure: a bare identifier fused to the next keyword.
	for _, keyword := range []string{"FROM", "WHERE", "SELECT", "RETURNING"} {
		glued := regexp.MustCompile(`(?i)[a-z0-9_]` + keyword + `\b`)
		if glued.MatchString(sql) {
			t.Errorf("%s is glued to the identifier before it:\n%s", keyword, sql)
		}
	}

	if !strings.Contains(sql, "FROM alert_settings") {
		t.Errorf("no FROM clause survived assembly:\n%s", sql)
	}
	if !strings.Contains(sql, "WHERE id = true") {
		t.Errorf("query must be pinned to the single row:\n%s", sql)
	}
}

// The scan lists in Load and Save must line up with alertSettingsColumns, in
// order. A mismatch is not a compile error — every column is one of three Go
// types — so it surfaces as silently transposed values, e.g. the offline
// cooldown landing in the fault cooldown. Counting them is a cheap proxy.
func TestColumnCountMatchesScanTargets(t *testing.T) {
	const wantColumns = 14 // 12 policy fields + updated_at + updated_by

	got := strings.Count(alertSettingsColumns, ",") + 1
	if got != wantColumns {
		t.Errorf("alertSettingsColumns lists %d columns, want %d — update both scan lists to match", got, wantColumns)
	}
}
