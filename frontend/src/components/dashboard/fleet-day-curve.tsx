"use client";

import { useMemo } from "react";

import { buildFleetCurve } from "@/lib/fleet-curve";
import { formatEnergy, formatPower } from "@/lib/format";
import type { FleetToday } from "@/hooks/use-fleet-today";
import { cn } from "@/lib/utils";

/**
 * The fleet's generation shape for the day so far.
 *
 * The wall already shows what the fleet is producing RIGHT NOW (the 3D scene's
 * solar callout) and how much it has produced in total (the header). Neither
 * answers the question an operator actually asks first in the morning: has
 * today gone normally? A flat-topped curve is a clear day, a jagged one is
 * cloud, a curve that stops mid-morning is a problem — and none of that is
 * visible in a single number.
 *
 * Drawn as a raw SVG rather than with Recharts: see lib/fleet-curve.ts for the
 * reasoning and for all of the arithmetic, which is unit-tested there.
 */

// viewBox units. The panel stretches this with preserveAspectRatio="none", so
// these are a coordinate system rather than a size — chosen roughly 4:1
// because that is the aspect a day curve reads well at.
const VB_W = 600;
const VB_H = 150;

export function FleetDayCurve({ data, className }: { data: FleetToday; className?: string }) {
  const curve = useMemo(
    () =>
      buildFleetCurve(data.points, {
        dayStart: data.day_start,
        now: new Date().toISOString(),
        width: VB_W,
        height: VB_H,
        bucketMinutes: data.bucket_minutes,
      }),
    [data],
  );

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Both halves are shrink-0 and the title truncates rather than wrapping.
          This card lives in a narrow column on a fixed-height screen, and a
          two-line heading steals that height from the curve itself — which is
          the only part of the card carrying information. */}
      <div className="mb-1 flex shrink-0 items-baseline justify-between gap-2 whitespace-nowrap">
        <h2 className="truncate text-base font-semibold">Today&apos;s generation</h2>
        {!curve.isEmpty && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            peak {formatPower(curve.peakW)}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="size-full overflow-visible"
          role="img"
          aria-label={`Fleet generation today, peak ${formatPower(curve.peakW)}, ${formatEnergy(data.energy_today_kwh)} so far`}
        >
          <defs>
            {/* currentColor so the fill follows the --solar token in both
                themes rather than pinning a hex that only works in one. */}
            <linearGradient id="fleet-curve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Faint marks at 06:00, 12:00 and 18:00. Enough to place the shape
              in the day from across a room; axis labels at this size would be
              unreadable and would only add clutter. */}
          {curve.hourMarks.map(({ hour, x }) => (
            <line
              key={hour}
              x1={x}
              y1={0}
              x2={x}
              y2={VB_H}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {curve.areaPath && (
            <path d={curve.areaPath} fill="url(#fleet-curve-fill)" className="text-solar" />
          )}
          {curve.linePath && (
            <path
              d={curve.linePath}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-solar"
            />
          )}

          {/* Where "now" is. The curve stops here by definition, so without a
              marker the empty right-hand side reads as the fleet having
              stopped rather than the day not being over. */}
          <line
            x1={curve.nowX}
            y1={0}
            x2={curve.nowX}
            y2={VB_H}
            className="stroke-muted-foreground"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {curve.isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No generation recorded yet today
          </div>
        )}
      </div>

      {/* Anchors the shape to the clock. Three labels, not an axis. */}
      <div className="mt-0.5 flex shrink-0 justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
