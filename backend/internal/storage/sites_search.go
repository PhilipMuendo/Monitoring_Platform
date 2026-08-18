package storage

import (
	"context"
	"fmt"

	"solar-monitor/internal/models"
)

// searchSiteLimit bounds a name search. Deliberately small: this exists to
// resolve a name an operator typed into the id a tool call needs, so a handful
// of candidates is the useful answer and a hundred is noise the model has to
// wade through.
const searchSiteLimit = 12

// SearchByName finds sites whose name or location matches a free-text query,
// case-insensitively.
//
// WHY THIS EXISTS. The AI chat previously resolved "how is Sanana hotel doing"
// by calling list_sites and scanning the result for the name. That works at 20
// sites and silently stops working at 101: List caps at defaultListLimit=100,
// so a site past the first page simply is not in what the model can see, and
// the honest-looking answer "I could not find that site" would be wrong. It is
// also wasteful — a hundred full telemetry records into the prompt on every
// question about one site.
//
// Matching is ILIKE '%q%' on name and location rather than full-text search.
// The fleet is a few hundred rows, an operator types a fragment of a name they
// already know, and substring matching handles the middle-of-name case
// ("kitale") that a prefix index would miss. If this ever needs to scale, the
// index to add is pg_trgm on lower(name).
func (r *SiteRepo) SearchByName(ctx context.Context, q string, activeOnly bool) ([]models.SiteWithStatus, error) {
	where := " WHERE (s.name ILIKE $1 OR s.location ILIKE $1) "
	if activeOnly {
		where += " AND s.is_active = TRUE "
	}
	rows, err := r.db.Pool.Query(ctx,
		siteWithStatusSelect+where+rankOrder+` LIMIT $2`,
		"%"+q+"%", searchSiteLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("search sites: %w", err)
	}
	defer rows.Close()

	out := make([]models.SiteWithStatus, 0, searchSiteLimit)
	for rows.Next() {
		s, err := scanSiteWithStatus(rows)
		if err != nil {
			return nil, fmt.Errorf("scan site: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
