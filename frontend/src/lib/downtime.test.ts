import { describe, expect, it } from "vitest";

import { downtimeLabel, downtimeTier } from "@/lib/downtime";

const NOW = new Date("2026-08-18T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("downtimeTier", () => {
  it("grades an outage by how long it has run", () => {
    expect(downtimeTier(ago(5 * MIN), NOW)).toBe("recent");
    expect(downtimeTier(ago(59 * MIN), NOW)).toBe("recent");
    expect(downtimeTier(ago(HOUR), NOW)).toBe("hours");
    expect(downtimeTier(ago(23 * HOUR), NOW)).toBe("hours");
    expect(downtimeTier(ago(DAY), NOW)).toBe("days");
    expect(downtimeTier(ago(9 * DAY), NOW)).toBe("days");
  });

  // A site registered minutes ago whose first poll has not run is not a
  // three-year outage, and must not outrank sites that actually stopped.
  it("treats a site that never reported as unknown, not as the worst case", () => {
    expect(downtimeTier(null, NOW)).toBe("unknown");
    expect(downtimeTier(undefined, NOW)).toBe("unknown");
    expect(downtimeTier("not a date", NOW)).toBe("unknown");
  });

  it("absorbs clock skew rather than reporting a negative outage", () => {
    expect(downtimeTier(new Date(NOW + HOUR).toISOString(), NOW)).toBe("recent");
  });
});

describe("downtimeLabel", () => {
  it("renders one coarse unit", () => {
    expect(downtimeLabel(ago(30_000), NOW)).toBe("just now");
    expect(downtimeLabel(ago(8 * MIN), NOW)).toBe("8m");
    expect(downtimeLabel(ago(4 * HOUR), NOW)).toBe("4h");
    expect(downtimeLabel(ago(3 * DAY + 4 * HOUR), NOW)).toBe("3d");
  });

  it("floors rather than rounds, so a label never claims more than elapsed", () => {
    expect(downtimeLabel(ago(119 * MIN), NOW)).toBe("1h");
    expect(downtimeLabel(ago(47 * HOUR), NOW)).toBe("1d");
  });

  it("says so plainly when a site has never reported", () => {
    expect(downtimeLabel(null, NOW)).toBe("no data yet");
    expect(downtimeLabel("garbage", NOW)).toBe("no data yet");
  });

  it("absorbs clock skew", () => {
    expect(downtimeLabel(new Date(NOW + HOUR).toISOString(), NOW)).toBe("just now");
  });
});
