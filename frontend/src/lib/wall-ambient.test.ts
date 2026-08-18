import { describe, expect, it } from "vitest";

import { WALL_DIM_MAX, wallDimOpacity } from "@/lib/wall-ambient";

describe("wallDimOpacity", () => {
  it("is fully bright through the working day", () => {
    for (const hour of [7, 9, 12, 15, 18.99]) {
      expect(wallDimOpacity(hour)).toBe(0);
    }
  });

  it("is fully dim through the night", () => {
    for (const hour of [20, 22, 0, 3, 5.99]) {
      expect(wallDimOpacity(hour)).toBe(WALL_DIM_MAX);
    }
  });

  // A hard step reads as the screen glitching and gets reported as a fault.
  it("ramps rather than steps at both boundaries", () => {
    expect(wallDimOpacity(19)).toBe(0);
    expect(wallDimOpacity(19.5)).toBeCloseTo(WALL_DIM_MAX / 2, 5);
    expect(wallDimOpacity(20)).toBe(WALL_DIM_MAX);

    expect(wallDimOpacity(6)).toBe(WALL_DIM_MAX);
    expect(wallDimOpacity(6.5)).toBeCloseTo(WALL_DIM_MAX / 2, 5);
    expect(wallDimOpacity(7)).toBe(0);
  });

  it("never exceeds the cap — the wall must stay readable at night", () => {
    for (let h = 0; h < 24; h += 0.1) {
      const o = wallDimOpacity(h);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(WALL_DIM_MAX);
    }
  });

  it("normalises out-of-range and non-finite hours instead of going opaque", () => {
    expect(wallDimOpacity(25)).toBe(wallDimOpacity(1));
    expect(wallDimOpacity(-2)).toBe(wallDimOpacity(22));
    expect(wallDimOpacity(NaN)).toBe(0);
  });
});
