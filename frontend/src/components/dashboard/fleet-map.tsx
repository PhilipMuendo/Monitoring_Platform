"use client";

import "leaflet/dist/leaflet.css";

import { DARK, LIGHT } from "@protomaps/basemaps";
import L from "leaflet";
import { useTheme } from "next-themes";
import { labelRules, leafletLayer, paintRules } from "protomaps-leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, useMap } from "react-leaflet";

import { statusDotClass } from "@/components/status-badge";
import { apiUrl } from "@/lib/api-client";
import {
  boundsKey,
  boundsOf,
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  geoSites,
  MAX_FIT_ZOOM,
  SINGLE_SITE_ZOOM,
  type GeoSite,
} from "@/lib/map-bounds";
import { cn } from "@/lib/utils";
import type { SiteWithStatus } from "@/lib/types";

// Self-hosted, per docs/TILES.md — a Kenya/East Africa extract of the public
// Protomaps basemap build. Served by the Go backend's /tiles route, not
// Next's public/ handling (see backend/internal/api/tiles.go).
const TILES_URL = apiUrl("/tiles/kenya.pmtiles");

interface FleetMapProps {
  sites: SiteWithStatus[] | undefined;
  interactive: boolean;
  className?: string;
}

export function FleetMap({ sites, interactive, className }: FleetMapProps) {
  const geo = useMemo(() => geoSites(sites), [sites]);

  return (
    <MapContainer
      center={FALLBACK_CENTER}
      zoom={FALLBACK_ZOOM}
      minZoom={4}
      maxZoom={MAX_FIT_ZOOM}
      className={cn("size-full rounded-lg bg-muted", className)}
      dragging={interactive}
      touchZoom={interactive}
      scrollWheelZoom={interactive}
      doubleClickZoom={interactive}
      boxZoom={interactive}
      keyboard={interactive}
      zoomControl={interactive}
      attributionControl={false}
    >
      <Basemap />
      <FitToSites sites={geo} />
      <KeepSized />
      {geo.length === 0 ? (
        <EmptyOverlay />
      ) : (
        geo.map((s) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={statusPinIcon(s.status)}
            interactive={interactive}
            keyboard={interactive}
          />
        ))
      )}
    </MapContainer>
  );
}

// protomaps-leaflet has no declarative react-leaflet binding, so the basemap
// is added imperatively via useMap(), same pattern as FitToSites/KeepSized
// below. Theme swap re-applies paintRules/labelRules and re-renders rather
// than recreating the layer, so panning/zoom state (on the interactive
// dashboard variant) survives a theme toggle.
function Basemap() {
  const map = useMap();
  const { resolvedTheme } = useTheme();
  const layerRef = useRef<ReturnType<typeof leafletLayer> | null>(null);

  useEffect(() => {
    const flavor = resolvedTheme === "dark" ? DARK : LIGHT;
    const layer = leafletLayer({
      url: TILES_URL,
      paintRules: paintRules(flavor),
      labelRules: labelRules(flavor, "en"),
      backgroundColor: flavor.background,
      maxDataZoom: MAX_FIT_ZOOM,
    });
    // protomaps-leaflet's return type doesn't structurally declare the
    // L.GridLayer members it actually has at runtime (it's built via
    // L.GridLayer.extend()), so Leaflet's own Layer-typed APIs need a cast.
    const leafletLayerInstance = layer as unknown as L.Layer;
    leafletLayerInstance.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(leafletLayerInstance);
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild handles theme changes below instead of tearing down on every render
  }, [map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const flavor = resolvedTheme === "dark" ? DARK : LIGHT;
    layer.paintRules = paintRules(flavor);
    layer.labelRules = labelRules(flavor, "en");
    layer.backgroundColor = flavor.background;
    layer.rerenderTiles();
  }, [resolvedTheme]);

  return null;
}

// react-leaflet has no declarative auto-fit prop. Keyed on boundsKey, not
// `sites` itself: useSites() polls every 30s and hands back a fresh array
// identity with identical coordinates each time, and re-running fitBounds
// on every poll would be a visible twitch on a display running for weeks.
function FitToSites({ sites }: { sites: GeoSite[] }) {
  const map = useMap();
  const key = boundsKey(sites);

  useEffect(() => {
    if (sites.length === 0) return; // keep the fallback center/zoom
    if (sites.length === 1) {
      map.setView([sites[0].lat, sites[0].lng], SINGLE_SITE_ZOOM, { animate: false });
      return;
    }
    const bounds = boundsOf(sites);
    if (!bounds) return;
    map.fitBounds([bounds.sw, bounds.ne], { padding: [24, 24], maxZoom: MAX_FIT_ZOOM, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the coordinate fingerprint, not the sites array
  }, [map, key]);

  return null;
}

// Leaflet caches the container's pixel size at init. This map sits inside a
// flex column whose height resolves after layout, and the wall page's
// stale-data banner (page.tsx) appears/disappears at runtime, stealing
// space from the grid row. A ResizeObserver on the container covers both
// the mount race and any later layout shift in one mechanism.
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function EmptyOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
      <p className="rounded-md bg-background/80 px-3 py-1.5 text-sm text-muted-foreground">No site coordinates</p>
    </div>
  );
}

// L.divIcon, not the default Leaflet icon (which resolves marker-icon.png
// relative to a CSS url that bundlers rewrite — the well-known broken-icon
// issue) and not L.circleMarker (needs a *resolved* color string, but the
// status palette lives in oklch() CSS custom properties with separate
// light/dark values — a divIcon's HTML can carry a Tailwind class and get
// light/dark for free instead).
//
// The class must come from statusDotClass()'s literal-valued lookup, never
// be template-built (`bg-status-${x}`) — Tailwind v4 scans source text, and
// a constructed class name is never generated, so the pin would render
// invisible.
function statusPinIcon(status: SiteWithStatus["status"]): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span class="block size-3.5 rounded-full ring-2 ring-background shadow-sm ${statusDotClass(status)}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}
