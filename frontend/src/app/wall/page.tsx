"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Sun, TrendingDown, TrendingUp } from "lucide-react";

import { FleetDayCurve } from "@/components/dashboard/fleet-day-curve";
import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { WallSitesGrid, wallSitePageCount } from "@/components/dashboard/wall-sites-grid";
import { StatusBadge } from "@/components/status-badge";
import { BrandBadge } from "@/components/brand-badge";
import { RequireAuth } from "@/components/layout/require-auth";
import { WallSizeGate } from "@/components/layout/wall-size-gate";
import { useAlertStream } from "@/hooks/use-alert-stream";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import { useFittedRows } from "@/hooks/use-fitted-rows";
import { useFleetToday } from "@/hooks/use-fleet-today";
import { useHealth } from "@/hooks/use-health";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useSites } from "@/hooks/use-sites";
import { useWallRotation } from "@/hooks/use-wall-rotation";
import { DOWNTIME_CLASS, downtimeLabel, downtimeTier } from "@/lib/downtime";
import { energyDeltaPct } from "@/lib/fleet-curve";
import { formatEnergy, formatPower } from "@/lib/format";
import { platformStatus } from "@/lib/platform-status";
import { fleetHour } from "@/lib/time-of-day";
import { wallDimOpacity } from "@/lib/wall-ambient";
import { readyCount, type RotatingPage } from "@/lib/wall-rotation";
import { cn } from "@/lib/utils";
import type { FleetSummary } from "@/lib/types";

/**
 * Height of one "Needs Attention" row, and the gap between them.
 *
 * The list no longer shows a fixed number of rows. It shows as many as fit,
 * measured — see useFittedRows for why a constant was wrong. These two numbers
 * are what the measurement divides by, so they must match the row's actual
 * rendered box: h-16 (64px) and gap-2 (8px) below.
 */
const ROW_PX = 64;
const ROW_GAP_PX = 8;
const PAGE_INTERVAL_MS = 8_000;

// How long each page holds the screen.
//
// Overview gets much longer than the others because it carries its own inner
// rotation: the "Needs Attention" list pages every PAGE_INTERVAL_MS, so a
// short dwell here would cut away before the later entries were ever shown.
// 40s covers five of its sub-pages, which is more than the list will normally
// have. The sites grid is static once drawn, so it only needs long enough to
// read across twenty tiles.
const OVERVIEW_DWELL_MS = 40_000;
const SITES_DWELL_MS = 25_000;
/** Must match TILE_PAGE_INTERVAL_MS in wall-sites-grid, which paces its own tile pages. */
const TILE_PAGE_INTERVAL_MS = 8_000;

/** Shown in the header so a viewer knows which page they are looking at. */
const PAGE_LABELS: Record<string, string> = {
  overview: "Fleet overview",
  sites: "All sites",
};

/**
 * Only warn when the *collection pipeline* has actually stalled. This is
 * three poll intervals at the default POLL_INTERVAL=5m; the summary's
 * data_age_seconds is the age of the freshest reading fleet-wide, so a
 * handful of permanently-offline sites no longer trip it.
 */
const STALE_AFTER_SECONDS = 15 * 60;

/**
 * The one fleet number nothing else on this screen already carries.
 *
 * The wall used to run the dashboard's six-card KpiRow under the header. Every
 * one of those cards turned out to be a second copy of something already on
 * screen:
 *
 *   solar output, grid flow, average battery  — printed by the 3D scene's own
 *                                               callouts, and by the 2D
 *                                               diagram's nodes when the scene
 *                                               is unavailable
 *   sites online                              — bottom-left corner of the 3D
 *                                               scene, and the hub node of the
 *                                               2D diagram
 *   active issues                             — the count already badged on
 *                                               "Needs Attention", a few
 *                                               centimetres to the right
 *
 * The band was costing ~110 px of a fixed-height screen to repeat the panel
 * beneath it. Only ENERGY TODAY appears nowhere else, so only energy today
 * survives — up here in the header's empty middle, which was dead space
 * between the title and the clock and is tall enough to hold it for free.
 *
 * (The "sites online" duplicate was not obvious from the source; it was caught
 * by looking at the rendered page, because the scene draws its copy from
 * inside its own container.)
 *
 * Kept on the DASHBOARD, where the full KpiRow still runs: that page scrolls,
 * has no wall-sized scene, and is the one people read from a desk.
 */
function WallHeaderStats({ summary, deltaPct }: { summary: FleetSummary; deltaPct: number | null }) {
  // Rounded before it is judged, so the arrow and the printed number can never
  // disagree — a +0.4% that displays as "0%" beside an up arrow reads as a bug.
  const rounded = deltaPct == null ? null : Math.round(deltaPct);
  const better = rounded != null && rounded > 0;

  return (
    // No responsive classes: WallSizeGate guarantees at least 1280px here, so
    // this always has room. If that floor is ever lowered, this is the first
    // thing that needs a breakpoint.
    <div className="text-center">
      <div className="flex items-baseline justify-center gap-2">
        <div className="font-mono text-2xl font-semibold tabular-nums text-solar">
          {formatEnergy(summary.energy_today_kwh)}
        </div>
        {rounded != null && rounded !== 0 && (
          <span
            className={cn(
              "flex items-center gap-0.5 font-mono text-sm tabular-nums",
              better ? "text-status-online" : "text-status-warning",
            )}
            // Spelled out for anyone reading it up close, because "-19%" on
            // its own invites the wrong comparison (against yesterday's whole
            // day, which at 09:00 would be alarming and meaningless).
            title={`Compared with the same time yesterday (${formatEnergy(summary.energy_today_kwh)} vs the same point in yesterday's day)`}
          >
            {better ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {Math.abs(rounded)}%
          </span>
        )}
      </div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Energy today{rounded != null && " vs yesterday"}
      </div>
    </div>
  );
}

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
  const { data: today } = useFleetToday();
  const { data: health } = useHealth();
  const now = useClock();
  // Read-only here: the wall is an unattended TV, so it inherits whichever
  // view was last chosen on the dashboard rather than showing a toggle
  // nobody is standing there to click.
  const { mode } = usePowerFlowViewMode();
  useAlertStream(true);

  const problemSites = useMemo(() => (sites ?? []).filter((s) => s.status !== "online"), [sites]);

  // Page size comes from the panel, not from a guess about it.
  const listRef = useRef<HTMLDivElement>(null);
  const pageSize = useFittedRows(listRef, { rowPx: ROW_PX, gapPx: ROW_GAP_PX, min: 2, max: 12 });

  const pageCount = Math.max(1, Math.ceil(problemSites.length / pageSize));
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
  const visible = problemSites.slice(safePage * pageSize, safePage * pageSize + pageSize);

  // One banner for everything wrong with the PLATFORM, replacing the old
  // stale-data-only warning. See lib/platform-status.ts for the precedence and
  // for why "we cannot reach this vendor" must not read as "these sites died".
  const issue = platformStatus({ health, summary, staleAfterSeconds: STALE_AFTER_SECONDS });

  const deltaPct = today ? energyDeltaPct(today.energy_today_kwh, today.energy_yesterday_to_now_kwh) : null;

  // Recomputed on the clock tick that already runs for the header, so the
  // ramp advances without a second timer. fleetHour reads the clock in Kenya,
  // not the viewer's — the wall hangs in the office it describes.
  const dim = wallDimOpacity(fleetHour(now));

  // Overview is always ready: it is the wall's home page and still reads as a
  // dashboard while data loads. The sites grid is skipped until there is
  // something in it, which also covers first paint and a failed fetch — with
  // one ready page the rotation stops and the wall simply holds on Overview.
  const pages = useMemo<RotatingPage[]>(() => {
    // The sites page holds long enough to show every tile page once. At 20
    // sites that is a single grid and the base dwell; at 100 it is five grids
    // cycling internally, and cutting away after 25s would mean the wall
    // never showed most of the fleet.
    const tilePages = wallSitePageCount(sites?.length ?? 0);
    return [
      { id: "overview", ready: true, dwellMs: OVERVIEW_DWELL_MS },
      {
        id: "sites",
        ready: (sites?.length ?? 0) > 0,
        dwellMs: Math.max(SITES_DWELL_MS, tilePages * TILE_PAGE_INTERVAL_MS),
      },
    ];
  }, [sites]);
  const activePage = useWallRotation(pages);
  const rotating = readyCount(pages) > 1;

  // h-screen + overflow-hidden, and every band below is either shrink-0 or a
  // min-h-0 flex child. An unattended wall display has nobody to scroll it,
  // so anything below the fold is simply never seen.
  return (
    // wall-burn-in-shift creeps the whole layout by a few pixels over 20
    // minutes so no border or heading sits on the same pixels for years. See
    // globals.css for why it is not suppressed under prefers-reduced-motion.
    <div className="wall-burn-in-shift relative flex h-screen flex-col overflow-hidden bg-background px-8 py-5 text-foreground">
      {/* After-hours dimming. An overlay rather than a CSS filter on the root:
          a filter would force the whole subtree — including the WebGL canvas —
          through an extra compositing pass every frame, which is a real cost
          on the TV. One black layer at a variable opacity is free.

          pointer-events-none and aria-hidden so it changes only brightness.
          Rendered even at 0 opacity so the transition has something to
          animate from at the boundary. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-[60000ms] ease-linear"
        style={{ opacity: dim }}
      />

      <header className="mb-4 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Brand green, not --solar. The mark beside the title is branding,
              not a reading — --solar means "this number is PV generation" and
              spending it here would dilute that. The logo itself is NOT used
              on this page: this header sits on --background, which is white
              under the light theme, and the supplied logo is light artwork
              for dark chrome. See components/layout/brand-logo.tsx. */}
          <Sun className="size-8 text-brand-accent" />
          <div>
            <h1 className="text-2xl font-bold">Solar Fleet Monitor</h1>
            {/* The subtitle names the page on screen instead of repeating the
                title. Dots only appear once there is more than one page worth
                showing — with a single ready page nothing rotates, and a lone
                dot would imply otherwise. */}
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">{PAGE_LABELS[pages[activePage].id]}</p>
              {rotating && (
                <div className="flex items-center gap-1">
                  {pages.map((p, i) => (
                    <span
                      key={p.id}
                      className={cn(
                        "size-1.5 rounded-full",
                        i === activePage ? "bg-foreground" : "bg-muted-foreground/30",
                        !p.ready && "opacity-0",
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {summary && <WallHeaderStats summary={summary} deltaPct={deltaPct} />}

        <div className="text-right">
          <div className="font-mono text-3xl font-semibold tabular-nums">
            {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-sm text-muted-foreground">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {/* Both pages stay MOUNTED, hidden with display:none rather than
          unmounted. Unmounting drops the 3D canvas's WebGL context, so every
          rotation would pay for a fresh one plus recompiling the scene's
          shaders and rebuilding its procedural geometry — which the wall's TV
          browser would feel, on a page that rotates all day. Hidden costs
          nothing either: a display:none element reports as not intersecting,
          so useRenderActive already puts the canvas into frameloop="never"
          while it is off screen. */}
      <div className="relative min-h-0 flex-1">
        {/* 3/4 and 1/4, matching the dashboard's own split exactly (see
            app/(app)/page.tsx, grid-cols-4 with the flow card at col-span-3).
            It was 3/5 and 2/5, which gave Needs Attention 40% of a wall-sized
            screen for a list of short rows.

            That was not just a proportion mismatch, it was actively shrinking
            the render. Orthographic zoom here is min(height x 0.163,
            width x 0.1417), and at 2/5 the flow card was narrow enough that
            the WIDTH term won — so the scene was being fitted to the column
            rather than to the panel. On a 1080p wall that is zoom 98 against
            the 139 the height allows. Taking the column to 1/4 moves the bind
            back onto height and the scene comes out about 40% larger, without
            touching the zoom law itself. */}
        <div
          className={cn(
            "absolute inset-0 grid grid-cols-1 gap-6 xl:grid-cols-4",
            pages[activePage].id !== "overview" && "hidden",
          )}
        >
          <div className="flex min-h-0 flex-col rounded-xl border bg-card p-5 xl:col-span-3">
            <h2 className="mb-2 shrink-0 text-lg font-semibold">Fleet Power Flow</h2>
            {summary && (
              <FleetPowerFlowView summary={summary} mode={mode} className="min-h-0 flex-1" />
            )}
          </div>

          {/* The right column carries TWO cards now. The day curve went here
              rather than in a full-width band under the scene, which is where
              it would naturally go on a scrolling dashboard: a band would take
              back the ~110px the KpiRow gave up, and the camera fit is
              height-bound at wall proportions, so it would come straight out
              of how large the building renders. This column costs the scene
              nothing.

              basis-[30%] and shrink-0, not flex-1: the list below changes
              height every time a site flips status, and a curve that resized
              on every poll would redraw its whole path all day. */}
          <div className="flex min-h-0 flex-col gap-6 xl:col-span-1">
            {/* Warnings live HERE, not in the band at the foot of the page.
                This column is a fixed grid track beside the scene, so its
                contents never change the scene's height — the whole reason
                the KpiRow was removed. See the note beside that band.

                Placed above the curve rather than below the list: it is the
                thing that changes how everything under it should be read
                ("unknown, not offline"), so it has to be read first. */}
            {issue?.severity === "warning" && (
              <div
                role="status"
                className="flex shrink-0 items-start gap-2 rounded-xl border border-status-warning/40 bg-status-warning/10 p-3 text-status-warning"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight">{issue.headline}</div>
                  {/* The sentence that stops a reader concluding the sites
                      died. Smaller here than in the critical band because the
                      column is narrow, but never omitted — without it the
                      headline alone is worse than saying nothing. */}
                  <div className="mt-1 text-xs leading-snug opacity-90">{issue.detail}</div>
                </div>
              </div>
            )}

            {today && (
              <div className="flex shrink-0 basis-[30%] flex-col rounded-xl border bg-card p-4">
                <FleetDayCurve data={today} className="flex-1" />
              </div>
            )}

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
              // The measured box holds ONLY rows. The pagination dots are a
              // sibling below it, deliberately: counted inside, they would eat
              // into the height the rows are measured against and the list
              // would fit one row too many and clip it.
              //
              // h-16 + gap-2 here must stay in step with ROW_PX/ROW_GAP_PX.
              <div className="flex min-h-0 flex-1 flex-col">
                <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                {visible.map((site) => (
                  <div
                    key={site.id}
                    // shrink-0 and a FIXED height. These were flex-1 min-h-0,
                    // which let a row shrink below its own two lines of
                    // content — so on a short panel the rows overlapped and
                    // the list became unreadable rather than merely short.
                    className="flex h-16 shrink-0 items-center justify-between gap-3 rounded-lg border px-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{site.name}</span>
                        <BrandBadge brand={site.brand} />
                      </div>
                      <StatusBadge status={site.status} className="mt-1" />
                    </div>
                    {/* HOW LONG, not just "offline". Twenty minutes is a
                        flaky link that will fix itself on the next cycle;
                        three days is a truck roll. The list used to render
                        both identically, so it said which sites were unhappy
                        and nothing about which to deal with first — and on a
                        screen nobody can click, that ordering signal is the
                        only triage available. */}
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm tabular-nums text-muted-foreground">
                        {formatPower(site.power_w)}
                      </div>
                      <div
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          DOWNTIME_CLASS[downtimeTier(site.last_seen_at)],
                        )}
                      >
                        {downtimeLabel(site.last_seen_at)}
                      </div>
                    </div>
                  </div>
                ))}
                </div>
                {pageCount > 1 && (
                  <div className="flex shrink-0 items-center justify-center gap-1.5 pt-2">
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

        <div className={cn("absolute inset-0", pages[activePage].id !== "sites" && "hidden")}>
          <WallSitesGrid sites={sites} />
        </div>
      </div>

      {/* CRITICAL ONLY down here. A band in this slot is a direct subtraction
          from the flex-1 region above it, which is where the 3D scene lives —
          measured at 86px, or 78% of the KpiRow this layout just removed to
          make the scene bigger. Paying that permanently for a warning would
          undo the whole point.

          So the banner's footprint scales with how much it invalidates the
          rest of the screen:

            critical  the database is down, or collection has stalled. Every
                      number on screen is stale or wrong, so the scene's size
                      is not the priority — take the height. Also rare.

            warning   a vendor is unreachable. Real, and worth saying, but the
                      rest of the display is still correct — and on this fleet
                      it is true most of the time, so it must not be a
                      permanent tax on the scene. Rendered in the right-hand
                      column instead, which is a fixed grid track: adding to it
                      costs the scene exactly nothing.

          See lib/platform-status.ts for which issue wins when several are
          true at once. */}
      {issue?.severity === "critical" && (
        <div
          role="status"
          className="mt-4 flex shrink-0 items-start gap-3 rounded-lg border border-status-critical/40 bg-status-critical/10 p-3 text-status-critical"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">{issue.headline}</div>
            {/* Sized for reading across a room. The detail is the half that
                changes what someone does, so it is not small print. */}
            <div className="text-sm opacity-90">{issue.detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WallPage() {
  return (
    // This route mounts RequireAuth itself rather than inheriting the (app)
    // layout, so it needs its own Suspense boundary: RequireAuth reads
    // useSearchParams to remember the return destination, and without a
    // boundary that opts the page out of prerendering and fails the build.
    //
    // RequireAuth is OUTSIDE the size gate on purpose: a signed-out visitor on
    // a phone should be sent to the login page like anywhere else, not told
    // their screen is too small for a page they cannot see either way.
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <RequireAuth>
        <WallSizeGate>
          <WallDisplay />
        </WallSizeGate>
      </RequireAuth>
    </Suspense>
  );
}
