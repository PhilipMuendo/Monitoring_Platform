"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Sun } from "lucide-react";

import { FleetMapView } from "@/components/dashboard/fleet-map-view";
import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { StatusBadge } from "@/components/status-badge";
import { BrandBadge } from "@/components/brand-badge";
import { RequireAuth } from "@/components/layout/require-auth";
import { useAlertStream } from "@/hooks/use-alert-stream";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useSites } from "@/hooks/use-sites";
import { formatPower } from "@/lib/format";

// The map now takes ~38% of the right-hand column (see the grid below), so
// "Needs Attention" has less vertical room than it did when it had the
// whole column. 4 rather than 3 keeps a dozen problem sites cycling every
// 24s instead of a sluggish 32s at the existing PAGE_INTERVAL_MS.
const PAGE_SIZE = 4;
const PAGE_INTERVAL_MS = 8_000;

/**
 * Only warn when the *collection pipeline* has actually stalled. This is
 * three poll intervals at the default POLL_INTERVAL=5m; the summary's
 * data_age_seconds is the age of the freshest reading fleet-wide, so a
 * handful of permanently-offline sites no longer trip it.
 */
const STALE_AFTER_SECONDS = 15 * 60;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function WallDisplay() {
  const { data: summary } = useFleetSummary();
  const { data: sites } = useSites();
  const now = useClock();
  // Read-only here: the wall is an unattended TV, so it inherits whichever
  // view was last chosen on the dashboard rather than showing a toggle
  // nobody is standing there to click.
  const { mode } = usePowerFlowViewMode();
  useAlertStream(true);

  const problemSites = useMemo(() => (sites ?? []).filter((s) => s.status !== "online"), [sites]);
  const pageCount = Math.max(1, Math.ceil(problemSites.length / PAGE_SIZE));
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), PAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pageCount]);

  // pageCount shrinks as sites recover, which can leave `page` pointing past
  // the end and render an empty list. Clamped during render rather than in an
  // effect, so there's no frame showing the stale index.
  const safePage = page < pageCount ? page : 0;
  const visible = problemSites.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const isStale = summary != null && summary.data_age_seconds > STALE_AFTER_SECONDS;

  // h-screen + overflow-hidden, and every band below is either shrink-0 or a
  // min-h-0 flex child. An unattended wall display has nobody to scroll it,
  // so anything below the fold is simply never seen.
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background px-8 py-5 text-foreground">
      <header className="mb-4 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <Sun className="size-8 text-solar" />
          <div>
            <h1 className="text-2xl font-bold">Solar Fleet Monitor</h1>
            <p className="text-sm text-muted-foreground">Live fleet overview</p>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-semibold tabular-nums">
            {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-sm text-muted-foreground">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {summary && (
        <div className="mb-4 shrink-0">
          <KpiRow summary={summary} />
        </div>
      )}

      {/* 5:2 — the power flow is the feature the office actually watches, so
          it takes ~71% of the width. The right column is untouched by the
          map addition below: its size/props aren't part of this split. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-7">
        <div className="flex min-h-0 flex-col rounded-xl border bg-card p-5 xl:col-span-5">
          <h2 className="mb-2 shrink-0 text-lg font-semibold">Fleet Power Flow</h2>
          {summary && (
            <FleetPowerFlowView summary={summary} mode={mode} className="min-h-0 flex-1" />
          )}
        </div>

        {/* Split vertically rather than flex-1/flex-1: if both cards grew
            and shrank with content, the map would resize every time a site
            flips status (i.e. constantly on a live fleet), and every resize
            needs an expensive invalidateSize(). Pinning the map to a fixed
            share confines that to just the stale-banner toggle below. */}
        <div className="flex min-h-0 flex-col gap-6 xl:col-span-2">
          <div className="flex min-h-0 shrink-0 basis-[38%] flex-col rounded-xl border bg-card p-4">
            <h2 className="mb-2 shrink-0 text-lg font-semibold">Fleet Map</h2>
            <FleetMapView sites={sites} className="min-h-0 flex-1" />
            <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">
              © Protomaps © OpenStreetMap contributors
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card p-5">
            <div className="mb-3 flex shrink-0 items-center justify-between">
              <h2 className="text-lg font-semibold">Needs Attention</h2>
              {problemSites.length > 0 && (
                <span className="rounded-full bg-status-critical/15 px-2.5 py-0.5 text-sm font-medium text-status-critical">
                  {problemSites.length}
                </span>
              )}
            </div>

            {problemSites.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <CheckCircle2 className="size-10 text-status-online" />
                <p>Every site is online</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                {visible.map((site) => (
                  <div
                    key={site.id}
                    className="flex min-h-0 flex-1 items-center justify-between gap-3 rounded-lg border px-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{site.name}</span>
                        <BrandBadge brand={site.brand} />
                      </div>
                      <StatusBadge status={site.status} className="mt-1" />
                    </div>
                    <div className="shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
                      {formatPower(site.power_w)}
                    </div>
                  </div>
                ))}
                {pageCount > 1 && (
                  <div className="flex shrink-0 items-center justify-center gap-1.5 pt-1">
                    {Array.from({ length: pageCount }).map((_, i) => (
                      <span
                        key={i}
                        className={`size-1.5 rounded-full ${i === safePage ? "bg-foreground" : "bg-muted-foreground/30"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isStale && (
        <div className="mt-4 flex shrink-0 items-center gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-status-warning">
          <AlertTriangle className="size-4" />
          Data may be stale — last collection over {Math.round(summary.data_age_seconds / 60)} minutes ago.
        </div>
      )}
    </div>
  );
}

export default function WallPage() {
  return (
    <RequireAuth>
      <WallDisplay />
    </RequireAuth>
  );
}
