import { describe, expect, it } from "vitest";

import { buildFleetCurve, energyDeltaPct, type FleetCurvePoint } from "@/lib/fleet-curve";

const DAY_START = "2026-08-18T00:00:00+03:00";
const OPTS = { dayStart: DAY_START, now: "2026-08-18T12:00:00+03:00", width: 600, height: 160, bucketMinutes: 15 };

function at(hour: number, power: number): FleetCurvePoint {
  const h = String(Math.floor(hour)).padStart(2, "0");
  const m = String(Math.round((hour % 1) * 60)).padStart(2, "0");
  return { time: `2026-08-18T${h}:${m}:00+03:00`, power_w: power };
}

describe("buildFleetCurve", () => {
  it("maps the day onto the full width regardless of how much data exists", () => {
    // A contiguous run at the 15-minute cadence — a gap here would (correctly)
    // split the path, which is a different behaviour tested below.
    const c = buildFleetCurve([at(6, 0), at(6.25, 20000), at(6.5, 40000)], OPTS);
    // 06:00 is a quarter of the way across a 600-wide day, at the baseline;
    // 06:30 is the peak, so it pins to the top.
    expect(c.linePath).toBe("M150,160 L156.25,80 L162.5,0");
    // The area is closed down to the baseline at both ends.
    expect(c.areaPath.startsWith("M150,160")).toBe(true);
    expect(c.areaPath.endsWith("L162.5,160 Z")).toBe(true);
  });

  it("places the now marker and the hour guides", () => {
    const c = buildFleetCurve([at(6, 1000)], OPTS);
    expect(c.nowX).toBe(300); // noon
    expect(c.hourMarks.map((m) => m.x)).toEqual([150, 300, 450]);
  });

  it("reports the peak and where it sits", () => {
    const c = buildFleetCurve([at(9, 20000), at(12, 48700), at(15, 30000)], OPTS);
    expect(c.peakW).toBe(48700);
    expect(c.peakX).toBe(300);
    expect(c.peakY).toBe(0);
  });

  // Drawing straight through a collection outage invents data: a flat span
  // reads as "the fleet held steady", when in fact nothing was measured.
  it("breaks the line across a collection gap instead of spanning it", () => {
    const withGap = buildFleetCurve([at(8, 10000), at(8.25, 12000), at(14, 30000), at(14.25, 31000)], OPTS);
    expect(withGap.linePath.match(/M/g)).toHaveLength(2);

    const contiguous = buildFleetCurve([at(8, 10000), at(8.25, 12000), at(8.5, 13000)], OPTS);
    expect(contiguous.linePath.match(/M/g)).toHaveLength(1);
  });

  it("emits no area for a lone sample, which would render as a spike", () => {
    const c = buildFleetCurve([at(9, 20000)], OPTS);
    expect(c.linePath).not.toBe("");
    expect(c.areaPath).toBe("");
  });

  it("reports empty rather than an unrenderable path when there is no data", () => {
    const c = buildFleetCurve([], OPTS);
    expect(c.isEmpty).toBe(true);
    expect(c.linePath).toBe("");
    // The marker must still be positioned, so the panel can show the time.
    expect(c.nowX).toBe(300);
  });

  // A zero y-range would divide by zero and emit NaN, which browsers silently
  // drop — the chart would just not appear, with no error anywhere.
  it("survives an all-zero series without emitting NaN", () => {
    const c = buildFleetCurve([at(6, 0), at(12, 0)], OPTS);
    expect(c.linePath).not.toContain("NaN");
    expect(c.areaPath).not.toContain("NaN");
  });

  it("clamps a clock skew instead of drawing off the panel", () => {
    const skewed = buildFleetCurve([at(6, 1000)], { ...OPTS, now: "2026-08-19T09:00:00+03:00" });
    expect(skewed.nowX).toBe(600);
    const behind = buildFleetCurve([at(6, 1000)], { ...OPTS, now: "2026-08-17T09:00:00+03:00" });
    expect(behind.nowX).toBe(0);
  });
});

describe("energyDeltaPct", () => {
  it("compares like with like", () => {
    expect(energyDeltaPct(92.1, 114.2)).toBeCloseTo(-19.35, 1);
    expect(energyDeltaPct(120, 100)).toBeCloseTo(20, 5);
  });

  // Before dawn both sides are near zero and the ratio explodes. "+4000%"
  // every morning teaches people to ignore the number entirely.
  it("declines to compare against a negligible baseline", () => {
    expect(energyDeltaPct(0.8, 0.02)).toBeNull();
    expect(energyDeltaPct(0, 0)).toBeNull();
  });

  it("returns null rather than NaN for missing figures", () => {
    expect(energyDeltaPct(NaN, 100)).toBeNull();
    expect(energyDeltaPct(100, NaN)).toBeNull();
  });
});
