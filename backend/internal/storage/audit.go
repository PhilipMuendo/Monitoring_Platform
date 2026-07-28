package storage

import (
	"context"
	"encoding/json"
)

type AuditRepo struct{ db *DB }

func NewAuditRepo(db *DB) *AuditRepo { return &AuditRepo{db: db} }

func (r *AuditRepo) Log(ctx context.Context, userID, action, entityType, entityID string, details any) {
	detailsJSON, _ := json.Marshal(details)
	// Best-effort: an audit-log write failure should never block the
	// actual admin action it's recording.
	_, _ = r.db.Pool.Exec(ctx, `
		INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
		VALUES (NULLIF($1, '')::uuid, $2, $3, NULLIF($4, '')::uuid, $5)
	`, userID, action, entityType, entityID, detailsJSON)
}
