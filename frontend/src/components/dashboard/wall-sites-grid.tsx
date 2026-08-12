"use client";

import { useEffect, useMemo, useState } from "react";

import { BrandBadge } from "@/components/brand-badge";
import { SITE_STATUS_ACCENT } from "@/components/dashboard/site-card";
import { StatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { formatPower } from "@/lib/format";
import { socIndicatorClass } from "@/lib/soc-color";
import { cn } from "@/lib/utils";
import type { SiteWithStatus } from "@/lib/types";

/**
 * Every site at once, as a wall of status-coloured tiles.
 *
 * Deliberately NOT sorted by status. Putting the problems first would reshuffle
 * tiles every time a site flips — constantly, on a live fleet — and destroy the
 * spatial memory that makes a wall display readable at a glance ("the bad one
 * is third from the left"). A stable alphabetical layout plus the accent bar
 * and tint does the same job without moving anything: SITE_STATUS_ACCENT exists
 * precisely so a faulted site is findable without reading any text.
 */
/**
 * Tiles shown at once: a 5-column grid four rows deep.
 *
 * The grid uses auto-rows-fr inside a fixed-height panel, so every extra row
 * makes every tile shorter. Twenty tiles is roughly the point where a name and
 * a power reading are still legible from across a room; a hundred in one grid
 * would be twenty rows of ~40px slivers, which is not a display, it is a
 * texture. Beyond this the grid pages instead of shrinking.
 */
export const WALL_TILES_PER_PAGE = 20;
const TILE_PAGE_INTERVAL_MS = 8_000;

/** How many tile pages a fleet of this size needs. Used to size the wall dwell. */
export function wallSitePageCount(siteCount: number): number {
  return Math.max(1, Math.ceil(siteCount / WALL_TILES_PER_PAGE));
}

export function WallSitesGrid({ sites }: { sites: SiteWithStatus[] | undefined }) {
  const ordered = useMemo(
    () => [...(sites ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [sites],
  );

  const pageCount = wallSitePageCount(ordered.length);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), TILE_PAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pageCount]);

  // Clamped during render, like the Needs Attention list: pageCount shrinks as
  // sites are removed, and a stale index would render an empty grid for a frame.
  const safePage = page < pageCount ? page : 0;
  const visible = ordered.slice(safePage * WALL_TILES_PER_PAGE, (safePage + 1) * WALL_TILES_PER_PAGE);

  if (ordered.length === 0) {
    return (
      <div className="flex size-full items-center justify-center rounded-xl border bg-card text-muted-foreground">
        No sites to display
      </div>
    );
  }

  return (
    <div className="flex size-full min-h-0 flex-col gap-2">
      {/* auto-rows-fr, so rows share the height evenly and the grid fills the
          panel rather than bunching at the top with dead space underneath. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {visible.map((site) => (
          <WallSiteTile key={site.id} site={site} />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1.5">
          {Array.from({ length: pageCount }).map((_, i) => (
            <span
              key={i}
              className={cn("size-1.5 rounded-full", i === safePage ? "bg-foreground" : "bg-muted-foreground/30")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WallSiteTile({ site }: { site: SiteWithStatus }) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-1.5 rounded-xl border border-l-[5px] bg-card p-3",
        SITE_STATUS_ACCENT[site.status],
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <p className="min-w-0 truncate text-base font-semibold leading-tight">{site.name}</p>
        <BrandBadge brand={site.brand} />
      </div>

      {/* Pushes the reading down to the bottom of the tile so the numbers line
          up across the whole grid, whatever length the names above them are. */}
      <div className="min-h-0 flex-1" />

      <div className="flex shrink-0 items-end justify-between gap-2">
        <StatusBadge status={site.status} />
        <span className="font-mono text-xl font-semibold tabular-nums">{formatPower(site.power_w)}</span>
      </div>

      {site.soc != null && (
        <div className="flex shrink-0 items-center gap-2">
          <Progress value={site.soc} className="h-1.5" indicatorClassName={socIndicatorClass(site.soc)} />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(site.soc)}%
          </span>
        </div>
      )}
    </div>
  );
}
