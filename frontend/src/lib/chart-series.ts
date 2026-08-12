import type { PowerPoint } from "@/lib/types";

export type HistoryRange = "24h" | "7d" | "30d";

/**
 * Expected spacing between consecutive readings, per range. The API serves
 * raw 5-minute rows for 24h and pre-aggregated hourly buckets beyond that
 * (see MetricsRepo.History24h / HistoryHourly).
 */
const STEP_MS: Record<HistoryRange, number> = {
  "24h": 5 * 60_000,
  "7d": 60 * 60_000,
  "30d": 60 * 60_000,
};

/** A reading with an epoch-ms timestamp, ready for a numeric time axis. */
export interface TimePoint {
  ts: number;
  power_w: number | null;
  /** Bucket peak; null on 24h where each point is already a single reading. */
  peak_w: number | null;
  load_w: number | null;
  grid_w: number | null;
  soc: number | null;
}

const GAP_BREAK: TimePoint = { ts: 0, power_w: null, peak_w: null, load_w: null, grid_w: null, soc: null };

/**
 * Converts history rows into points for a numeric (time-scaled) axis, and
 * inserts an all-null row wherever readings are missing.
 *
 * Both halves matter, and they fix the same underlying problem — a chart
 * that invents data it never received:
 *
 *  - Epoch timestamps let the axis be `type="number" scale="time"`. Passing
 *    the ISO string as `dataKey` gives Recharts a *category* axis, which
 *    spaces every point equally no matter how far apart in time they are. A
 *    collector outage then renders at the same width as a 5-minute step,
 *    and the axis reads e.g. 11:02, 11:07, 11:12, 11:17, 23:37 — four
 *    5-minute gaps and one 12-hour gap, all the same size.
 *
 *  - The null row breaks the line. Recharts does not connect across null by
 *    default, so a gap shows as a gap. Without it, `type="monotone"` draws
 *    a smooth, entirely plausible curve straight through the missing hours.
 *
 * On a monitoring tool an outage is precisely the thing that must stay
 * visible, so neither is cosmetic.
 */
export function toTimeSeries(points: PowerPoint[], range: HistoryRange): TimePoint[] {
  const step = STEP_MS[range];
  // 2.5x rather than 1x: real poll intervals jitter by a few seconds, and a
  // single late reading shouldn't read as an outage.
  const gapThreshold = step * 2.5;

  const out: TimePoint[] = [];
  for (const p of points) {
    const ts = new Date(p.time).getTime();
    if (Number.isNaN(ts)) continue;

    const prev = out[out.length - 1];
    if (prev && ts - prev.ts > gapThreshold) {
      out.push({ ...GAP_BREAK, ts: prev.ts + step });
    }

    out.push({
      ts,
      power_w: p.power_w ?? null,
      peak_w: p.peak_power_w ?? null,
      load_w: p.load_w ?? null,
      grid_w: p.grid_w ?? null,
      soc: p.soc ?? null,
    });
  }
  return out;
}
