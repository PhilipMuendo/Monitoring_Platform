import { describe, expect, it } from "vitest";

import { toTimeSeries } from "@/lib/chart-series";
import type { PowerPoint } from "@/lib/types";

function point(time: string, power: number | null = 1000): PowerPoint {
  return {
    time,
    power_w: power,
    load_w: null,
    grid_w: null,
    soc: null,
    energy_today_kwh: null,
  };
}

describe("toTimeSeries", () => {
  it("converts ISO timestamps to epoch ms for a numeric time axis", () => {
    const out = toTimeSeries([point("2026-07-29T10:00:00Z")], "24h");
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(Date.parse("2026-07-29T10:00:00Z"));
  });

  // The bug this function exists for: on a category axis a 12-hour outage
  // renders the same width as a 5-minute step, and `type="monotone"` draws
  // a smooth, entirely plausible curve straight through hours that were
  // never measured.
  it("inserts a null break across a real gap so the line is severed", () => {
    const out = toTimeSeries(
      [
        point("2026-07-29T10:00:00Z"),
        point("2026-07-29T10:05:00Z"),
        point("2026-07-29T22:00:00Z"), // ~12h later
      ],
      "24h",
    );

    expect(out).toHaveLength(4);
    const gap = out[2];
    expect(gap.power_w).toBeNull();
    expect(gap.load_w).toBeNull();
    expect(gap.grid_w).toBeNull();
    expect(gap.soc).toBeNull();
    // The break sits one step after the last real reading, not at the far
    // side of the gap, so the line stops where the data stopped.
    expect(gap.ts).toBe(out[1].ts + 5 * 60_000);
  });

  // Poll intervals jitter by a few seconds; a slightly late reading is not
  // an outage and must not sever the line.
  it("tolerates jitter up to 2.5x the expected step", () => {
    const out = toTimeSeries(
      [
        point("2026-07-29T10:00:00Z"),
        point("2026-07-29T10:10:00Z"), // 2x the 5-minute step
      ],
      "24h",
    );
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.power_w !== null)).toBe(true);
  });

  it("uses the hourly step for 7d and 30d ranges", () => {
    const hourApart = [point("2026-07-29T10:00:00Z"), point("2026-07-29T12:00:00Z")];

    // 2h apart is within 2.5x of an hourly step — no break.
    expect(toTimeSeries(hourApart, "7d")).toHaveLength(2);
    expect(toTimeSeries(hourApart, "30d")).toHaveLength(2);

    // The same spacing against a 5-minute step is a 24-step gap.
    expect(toTimeSeries(hourApart, "24h")).toHaveLength(3);
  });

  it("preserves a genuine zero rather than nulling it", () => {
    const out = toTimeSeries([point("2026-07-29T22:00:00Z", 0)], "24h");
    // 0 W at night is a measurement. Coercing it to null would hide a
    // working site behind a gap.
    expect(out[0].power_w).toBe(0);
  });

  it("maps a missing channel to null", () => {
    const out = toTimeSeries([point("2026-07-29T10:00:00Z", null)], "24h");
    expect(out[0].power_w).toBeNull();
  });

  it("skips unparseable timestamps instead of emitting NaN", () => {
    const out = toTimeSeries(
      [point("not-a-date"), point("2026-07-29T10:00:00Z")],
      "24h",
    );
    expect(out).toHaveLength(1);
    expect(Number.isNaN(out[0].ts)).toBe(false);
  });

  it("handles an empty series", () => {
    expect(toTimeSeries([], "24h")).toEqual([]);
  });

  it("never emits two consecutive breaks for one gap", () => {
    const out = toTimeSeries(
      [point("2026-07-29T00:00:00Z"), point("2026-07-29T23:00:00Z")],
      "24h",
    );
    const nulls = out.filter((p) => p.power_w === null);
    expect(nulls).toHaveLength(1);
  });
});
