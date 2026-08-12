import type { SiteStatus, SiteWithStatus } from "@/lib/types";

export interface GeoSite {
  id: string;
  name: string;
  status: SiteStatus;
  lat: number;
  lng: number;
}

/** Kenya's approximate centroid — used only when no site has usable coordinates. */
export const FALLBACK_CENTER: [number, number] = [0.02, 37.9];
export const FALLBACK_ZOOM = 6;
/** fitBounds on a single point is a zero-area box and snaps to maxZoom, so a
 * lone site needs an explicit view instead. */
export const SINGLE_SITE_ZOOM = 9;
/**
 * Must stay <= the maxzoom baked into the self-hosted .pmtiles extract (see
 * docs/TILES.md). A tightly-clustered fleet would otherwise fitBounds to a
 * zoom level the tile set doesn't have, rendering blank tiles.
 */
export const MAX_FIT_ZOOM = 9;

/**
 * Filters sites down to ones with a plausible, usable coordinate pair.
 *
 * Rejects, in order: missing lat/lng (the documented nullable case),
 * non-finite numbers, out-of-range values (catches a transposed lat/lng
 * pair), and exactly (0, 0). Null Island is a legal coordinate, but for a
 * Kenya-only fleet it is far more likely to be an unset DECIMAL column that
 * defaulted to 0 instead of NULL than a real site in the Gulf of Guinea —
 * treating it as real would drag fitBounds across half of Africa and shrink
 * every genuine pin into an unreadable cluster.
 */
export function geoSites(sites: SiteWithStatus[] | undefined): GeoSite[] {
  if (!sites) return [];
  const out: GeoSite[] = [];
  for (const site of sites) {
    const lat = site.latitude;
    const lng = site.longitude;
    if (lat == null || lng == null) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (lat === 0 && lng === 0) continue;
    out.push({ id: site.id, name: site.name, status: site.status, lat, lng });
  }
  return out;
}

export interface LatLngBoundsLiteral {
  sw: [number, number];
  ne: [number, number];
}

/** Returns null for zero sites — never a degenerate bounds object, which
 * Leaflet's fitBounds throws on. */
export function boundsOf(sites: GeoSite[]): LatLngBoundsLiteral | null {
  if (sites.length === 0) return null;
  let minLat = sites[0].lat;
  let maxLat = sites[0].lat;
  let minLng = sites[0].lng;
  let maxLng = sites[0].lng;
  for (const s of sites) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  }
  return { sw: [minLat, minLng], ne: [maxLat, maxLng] };
}

/**
 * Stable identity for a coordinate set, derived from sorted "id:lat:lng"
 * pairs. useSites() polls every 30s and hands back a fresh array identity
 * with identical coordinates each time; keying a re-fit effect on this
 * string instead of the array itself means fitBounds only re-runs when a
 * site's coordinates actually change, not on every poll.
 */
export function boundsKey(sites: GeoSite[]): string {
  return sites
    .map((s) => `${s.id}:${s.lat}:${s.lng}`)
    .sort()
    .join("|");
}
