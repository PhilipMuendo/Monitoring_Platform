import { describe, expect, it } from "vitest";

import { fleetHour, timeOfDayInFleetZone } from "@/lib/time-of-day";

// Kenya is UTC+3 with no daylight saving, so every UTC instant below maps to a
// Nairobi wall-clock time exactly three hours later. The point of testing
// through real Date objects rather than stubbing the hour is that the timezone
// conversion is the part most likely to break — a naive implementation using
// the *viewer's* locale would pass a stubbed test and fail here.
const utc = (iso: string) => new Date(`${iso}Z`);

describe("fleetHour", () => {
  it("converts UTC to Nairobi local time", () => {
    expect(fleetHour(utc("2026-08-14T09:00:00"))).toBeCloseTo(12);
    expect(fleetHour(utc("2026-08-14T00:00:00"))).toBeCloseTo(3);
  });

  it("wraps past midnight rather than reporting hour 24", () => {
    // 21:30 UTC is 00:30 the next day in Nairobi. An implementation using
    // hour12:false instead of hourCycle:h23 can render this as "24", which
    // would read as late evening instead of just after midnight.
    expect(fleetHour(utc("2026-08-14T21:30:00"))).toBeCloseTo(0.5);
  });

  it("carries minutes as a fraction", () => {
    expect(fleetHour(utc("2026-08-14T15:45:00"))).toBeCloseTo(18.75);
  });
});

describe("timeOfDayInFleetZone", () => {
  it("is day through the middle of the day", () => {
    expect(timeOfDayInFleetZone(utc("2026-08-14T09:00:00"))).toBe("day"); // 12:00
    expect(timeOfDayInFleetZone(utc("2026-08-14T04:30:00"))).toBe("day"); // 07:30
    expect(timeOfDayInFleetZone(utc("2026-08-14T14:45:00"))).toBe("day"); // 17:45
  });

  it("is night through the middle of the night", () => {
    expect(timeOfDayInFleetZone(utc("2026-08-14T21:30:00"))).toBe("night"); // 00:30
    expect(timeOfDayInFleetZone(utc("2026-08-14T02:00:00"))).toBe("night"); // 05:00
    expect(timeOfDayInFleetZone(utc("2026-08-14T18:00:00"))).toBe("night"); // 21:00
  });

  it("is dusk either side of the day", () => {
    expect(timeOfDayInFleetZone(utc("2026-08-14T03:30:00"))).toBe("dusk"); // 06:30 dawn
    expect(timeOfDayInFleetZone(utc("2026-08-14T15:30:00"))).toBe("dusk"); // 18:30
  });

  it("switches exactly on each boundary", () => {
    // The boundary hour itself belongs to the later phase, in all four cases.
    expect(timeOfDayInFleetZone(utc("2026-08-14T02:59:00"))).toBe("night"); // 05:59
    expect(timeOfDayInFleetZone(utc("2026-08-14T03:00:00"))).toBe("dusk"); // 06:00
    expect(timeOfDayInFleetZone(utc("2026-08-14T04:14:00"))).toBe("dusk"); // 07:14
    expect(timeOfDayInFleetZone(utc("2026-08-14T04:15:00"))).toBe("day"); // 07:15
    expect(timeOfDayInFleetZone(utc("2026-08-14T14:59:00"))).toBe("day"); // 17:59
    expect(timeOfDayInFleetZone(utc("2026-08-14T15:00:00"))).toBe("dusk"); // 18:00
    expect(timeOfDayInFleetZone(utc("2026-08-14T16:14:00"))).toBe("dusk"); // 19:14
    expect(timeOfDayInFleetZone(utc("2026-08-14T16:15:00"))).toBe("night"); // 19:15
  });

  it("does not shift across the year — Kenya has no daylight saving", () => {
    // Same wall-clock time in January and July must give the same phase. This
    // is the assumption the fixed thresholds rest on; if it ever stops holding
    // the boundaries need a real solar calculation, not a nudge.
    expect(timeOfDayInFleetZone(utc("2026-01-15T15:30:00"))).toBe("dusk");
    expect(timeOfDayInFleetZone(utc("2026-07-15T15:30:00"))).toBe("dusk");
  });
});
