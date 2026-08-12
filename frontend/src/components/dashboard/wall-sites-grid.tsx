"use client";

import { useMemo } from "react";

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
export function WallSitesGrid({ sites }: { sites: SiteWithStatus[] | undefined }) {
  const ordered = useMemo(
    () => [...(sites ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [sites],
  );

  if (ordered.length === 0) {
    return (
      <div className="flex size-full items-center justify-center rounded-xl border bg-card text-muted-foreground">
        No sites to display
      </div>
    );
  }

  return (
    // auto-rows-fr, so rows share the height evenly and the grid fills the
    // panel rather than bunching at the top with dead space underneath.
    <div className="grid size-full auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {ordered.map((site) => (
        <WallSiteTile key={site.id} site={site} />
      ))}
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
