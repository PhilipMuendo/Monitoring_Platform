/**
 * Geometry for the wall display's fleet generation curve.
 *
 * WHY NOT RECHARTS. Recharts is already in this app, lazily, on the site
 * detail route — and it is ~100 KB gzipped. Putting it on the wall would add
 * that to a page whose whole point this session was to make the 3D scene
 * bigger and the payload smaller, to draw a chart with no tooltips, no legend,
 * no axes worth reading from four metres away, and no interaction because
 * nobody is standing there. What the wall needs is a filled shape. That is a
 * path string, and a path string is pure arithmetic — which also makes it
 * testable without a DOM, matching how the rest of lib/ is tested.
 *
 * All output is in viewBox units. The consumer renders with
 * preserveAspectRatio="none" and vector-effect="non-scaling-stroke", so the
 * shape stretches to the panel while the stroke stays even.
 */

export interface FleetCurvePoint {
  time: string;
  power_w: number;
}

export interface FleetCurveOptions {
  /** Local midnight that starts the day, ISO. The x domain is this + 24h. */
  dayStart: string;
  /** Now, ISO. Used to place the "so far" marker. */
  now: string;
  width: number;
  height: number;
  /** Bucket size of the series, minutes. Drives gap detection. */
  bucketMinutes: number;
}

export interface FleetCurve {
  /** Filled area under the curve. Empty string when there is nothing to draw. */
  areaPath: string;
  /** The curve itself, possibly in several subpaths — see the gap note below. */
  linePath: string;
  /** Highest bucket in the series, watts. 0 when empty. */
  peakW: number;
  /** Where the peak sits, in viewBox units, for labelling it. */
  peakX: number;
  peakY: number;
  /** x of "now", so the panel can show how far through the day it is. */
  nowX: number;
  /** Hour marks (06:00, 12:00, 18:00) as x positions, for faint guides. */
  hourMarks: { hour: number; x: number }[];
  isEmpty: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MARKS = [6, 12, 18];

/**
 * A gap wider than this many buckets breaks the line instead of spanning it.
 *
 * Drawing straight through a collection outage invents data: a flat line from
 * 08:00 to 14:00 reads as "the fleet held steady all morning" when what
 * actually happened is that we could not reach the inverters. Breaking the
 * path leaves a visible hole, which is the true statement.
 */
const MAX_GAP_BUCKETS = 2;

/** Rounds to keep the emitted path readable and small. */
const r = (n: number) => Math.round(n * 100) / 100;

export function buildFleetCurve(
  points: FleetCurvePoint[],
  { dayStart, now, width, height, bucketMinutes }: FleetCurveOptions,
): FleetCurve {
  const start = new Date(dayStart).getTime();
  const nowMs = new Date(now).getTime();

  const hourMarks = HOUR_MARKS.map((hour) => ({
    hour,
    x: r((hour / 24) * width),
  }));
  // Clamped: a clock skew between browser and server must not push the marker
  // off the panel or invert the "so far" shading.
  const nowX = r(Math.max(0, Math.min(1, (nowMs - start) / DAY_MS)) * width);

  const usable = points.filter((p) => Number.isFinite(p.power_w));
  if (usable.length === 0) {
    return { areaPath: "", linePath: "", peakW: 0, peakX: 0, peakY: height, nowX, hourMarks, isEmpty: true };
  }

  const peakW = Math.max(...usable.map((p) => p.power_w));
  // The y domain never collapses: with a flat or all-zero series, dividing by
  // a zero range would emit NaN and the browser would silently drop the path.
  const yMax = peakW > 0 ? peakW : 1;

  const xOf = (t: string) =>
    Math.max(0, Math.min(1, (new Date(t).getTime() - start) / DAY_MS)) * width;
  const yOf = (w: number) => height - (w / yMax) * height;

  const gapMs = MAX_GAP_BUCKETS * bucketMinutes * 60 * 1000;

  // Split into runs of contiguous samples, then emit one subpath per run.
  const runs: FleetCurvePoint[][] = [];
  let run: FleetCurvePoint[] = [];
  let prevMs = 0;
  for (const p of usable) {
    const ms = new Date(p.time).getTime();
    if (run.length > 0 && ms - prevMs > gapMs) {
      runs.push(run);
      run = [];
    }
    run.push(p);
    prevMs = ms;
  }
  if (run.length > 0) runs.push(run);

  const lineParts: string[] = [];
  const areaParts: string[] = [];
  for (const segment of runs) {
    const coords = segment.map((p) => ({ x: r(xOf(p.time)), y: r(yOf(p.power_w)) }));
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
    lineParts.push(line);

    // A single-sample run has no width to fill, so it contributes a dot on the
    // line and nothing to the area. Closing a zero-width shape would render a
    // vertical hairline that reads as a spike.
    if (coords.length > 1) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      areaParts.push(`M${first.x},${r(height)} ${line.replace(/^M/, "L")} L${last.x},${r(height)} Z`);
    }
  }

  const peakPoint = usable.reduce((a, b) => (b.power_w > a.power_w ? b : a));

  return {
    areaPath: areaParts.join(" "),
    linePath: lineParts.join(" "),
    peakW,
    peakX: r(xOf(peakPoint.time)),
    peakY: r(yOf(peakPoint.power_w)),
    nowX,
    hourMarks,
    isEmpty: false,
  };
}

/**
 * Percentage change of today against the same point yesterday.
 *
 * null when yesterday has no meaningful baseline — before dawn both sides are
 * near zero and the ratio explodes, so "+4000%" would appear every morning on
 * a fleet that generated 0.02 kWh yesterday and 0.8 kWh today. A missing
 * comparison is better than a meaningless one.
 */
export function energyDeltaPct(todayKWh: number, yesterdayToNowKWh: number): number | null {
  const MIN_BASELINE_KWH = 1;
  if (!Number.isFinite(todayKWh) || !Number.isFinite(yesterdayToNowKWh)) return null;
  if (yesterdayToNowKWh < MIN_BASELINE_KWH) return null;
  return ((todayKWh - yesterdayToNowKWh) / yesterdayToNowKWh) * 100;
}
