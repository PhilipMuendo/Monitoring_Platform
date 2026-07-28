// Package adapters holds cross-brand adapter concerns that don't belong
// to models (which must stay dependency-free) but are shared by more
// than one brand package.
package adapters

import "context"

// SiteDescriber is optionally implemented by a models.BrandAdapter that
// can report site metadata (name, capacity, location) directly from the
// brand's own API. The collector uses it to auto-register newly seen
// sites in the `sites` table so staff don't have to hand-type
// brand_site_id/capacity for brands with self-describing APIs.
//
// Brands that can't yet describe themselves (Ingecon before its docs are
// confirmed, Sosen before a scraper exists) simply don't implement this —
// their sites are added exclusively through the admin UI, keyed by the
// brand_site_id visible in that brand's own portal. Once real telemetry
// starts flowing under that brand_site_id, it just works.
type SiteDescriber interface {
	Describe(ctx context.Context) ([]SiteDescriptor, error)
}

type SiteDescriptor struct {
	BrandSiteID string
	Name        string
	CapacityKW  float64
	Location    string
}
