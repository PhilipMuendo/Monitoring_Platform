# Self-hosted map tiles

The wall display's fleet map (`frontend/src/components/dashboard/fleet-map.tsx`) renders a status-colored pin per site over a basemap. The basemap is a single self-hosted **vector tile archive** (`.pmtiles`), served by the Go backend at `/tiles` (`backend/internal/api/tiles.go`), not fetched from a third party at runtime.

## Why self-hosted

The wall display runs unattended, on a Smart TV, for weeks at a time. OpenStreetMap's tile usage policy explicitly prohibits bulk and kiosk use of the public `tile.openstreetmap.org` endpoint, and an unattended TV shouldn't depend on any third party's uptime, rate limits, or API key rotation — the same "kiosk resilience" reasoning already applied elsewhere on this page. Self-hosting means the map keeps working even if the upstream provider is unreachable, and after first load the browser never touches the network for tiles again (see the `Cache-Control: immutable` header `tileHandler` sets).

## Format: vector, not raster

The map uses [Protomaps](https://protomaps.com) `.pmtiles` — one file containing vector tiles, rendered client-side by `protomaps-leaflet`. This was chosen over a raster PNG tile pyramid for one reason: the app has a light/dark theme, and a fixed-color raster tile set can't follow it. A vector tile's *style* is a JS object, so `frontend/src/components/dashboard/fleet-map.tsx` swaps between `@protomaps/basemaps`'s `LIGHT`/`DARK` flavors when the theme changes — matching the rest of the UI instead of a CSS-invert filter hack over baked images.

## Scope: Kenya / East Africa

The fleet's sites are in Kenya. A single-country bounding box keeps the extract small — at zoom levels 4–10 that's roughly:

| zoom | ≈ tiles |
|---|---|
| 4–5 | 1 each |
| 6 | 4 |
| 7 | 12 |
| 8 | 48 |
| 9 | 180 |
| 10 | ~670 |
| **total (z4–10)** | **≈ 915** |

Trivial — a single extract operation, not a rendering pipeline. The bbox used below (`33.5,-5.0,42.0,5.5`, in `min-lon,min-lat,max-lon,max-lat` order) covers Kenya with margin into neighboring countries.

## Generating the extract

This is an operator step, run once (or occasionally, when the upstream basemap updates) — not part of the build or deploy pipeline, and not something that runs inside a coding session.

### 1. Install the `pmtiles` CLI

A single Go binary, no external dependencies. Either:
- Download a release for your OS/arch from [github.com/protomaps/go-pmtiles/releases](https://github.com/protomaps/go-pmtiles/releases), or
- Use the Docker image: `docker run --rm -v "$PWD:/data" protomaps/go-pmtiles ...`

### 2. Find the current basemap build URL

Protomaps publishes daily Version 4 basemap builds at **maps.protomaps.com/builds**. Their own docs note "URLs may change and hotlinking to these downloads is discouraged" — visit that page and copy the current build's `.pmtiles` URL rather than hardcoding one here.

### 3. Extract the Kenya/East Africa bbox

```bash
pmtiles extract <CURRENT_BUILD_URL> kenya.pmtiles \
  --bbox=33.5,-5.0,42.0,5.5 \
  --maxzoom=10
```

**`--maxzoom=10` must stay ≥ `MAX_FIT_ZOOM` in `frontend/src/lib/map-bounds.ts` (currently `9`)** — that constant also caps the map's `fitBounds`/`maxZoom`, so the frontend never requests a zoom level this extract doesn't have. If you regenerate at a different max zoom, update `MAX_FIT_ZOOM` to match — nothing else enforces this invariant except this note and the comment in `map-bounds.ts`.

### 4. Deploy it

Place the resulting file at `./tiles/kenya.pmtiles` relative to `docker-compose.yml`, which bind-mounts `./tiles` into the backend container at `/app/tiles` (read-only). Set `TILES_DIR=/app/tiles` (already the compose default — see `TILES_DIR` in `.env.example`). No rebuild or restart is required beyond the container picking up the new file on next request; the route reads straight off disk.

The file must **never be committed** — `.gitignore` already excludes `/tiles/` and `*.pmtiles`. Treat it like any other environment-specific deployment artifact.

## Attribution

Both the extracted data and the map style require attribution. `fleet-map.tsx`'s wall-display card renders `© Protomaps © OpenStreetMap contributors` in its footer (`attributionControl={false}` on the Leaflet map removes the default widget, which is illegible at TV viewing distance — this footer line replaces it and satisfies the same obligation). Don't drop it when touching this component later.

## Debugging a blank map

- **CORS is not the cause.** The root CORS middleware applies to `/tiles` like every other route, but `protomaps-leaflet`'s tile fetches are plain range-request `fetch()` calls, not subject to CORS preflight in any way that would explain a blank map. If tiles aren't loading, look at `TILES_DIR`/the file's presence first.
- **Check the boot log.** `tileHandler` logs a `slog.Warn` at startup if `TILES_DIR` is set but unreadable — "why is the map blank" should be answerable from one log line, not a browser debugging session.
- **A missing `kenya.pmtiles`** degrades cleanly: the route still mounts, individual tile requests 404, and the map shows its `bg-muted` background with pins but no basemap underneath. This is deliberate (see `tiles.go`'s doc comment) — a missing basemap is cosmetic, not a reason for the map or the server to fail.
