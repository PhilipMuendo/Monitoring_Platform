import type { TimeOfDay } from "@/lib/power-flow-colors";

/**
 * The fleet's timezone, not the viewer's.
 *
 * The 3D scene is a picture of a site, and every site is in Kenya. Someone
 * opening the dashboard from another timezone should see whether it is dark
 * AT THE INSTALLATION, not where they happen to be sitting — the panel would
 * otherwise show a sunlit house while the fleet's solar output sat at zero,
 * which is exactly the kind of quiet contradiction that makes a monitoring
 * product feel untrustworthy.
 *
 * Kenya is UTC+3 year-round and observes no daylight saving, so this never
 * shifts. It is still resolved through the IANA database rather than hardcoded
 * as +3, because a fixed offset is the sort of thing that is right until it
 * isn't.
 */
export const FLEET_TIME_ZONE = "Africa/Nairobi";

/**
 * Phase boundaries, as decimal hours in Nairobi local time.
 *
 * Fixed thresholds are usually a bad approximation of sunrise and sunset, and
 * here they are a genuinely good one: Nairobi sits at 1.3 degrees south, so
 * across the entire year sunrise moves between about 06:23 and 06:42 and
 * sunset between about 18:25 and 18:52 — a spread of under twenty minutes.
 * Anywhere further from the equator this would need a real solar position
 * calculation; on the equator it would buy nothing but a dependency.
 *
 * The dusk band is deliberately wider than civil twilight (~22 minutes here).
 * It is doing a visual job rather than an astronomical one: it is the window
 * in which the scene reads as transitional instead of snapping between full
 * daylight and full dark, and a band shorter than about an hour is on screen
 * so briefly that it is not worth having.
 */
const DAWN_START = 6.0;
const DAY_START = 7.25;
const DUSK_START = 18.0;
const NIGHT_START = 19.25;

/**
 * Built once. Constructing an Intl.DateTimeFormat is the expensive part of
 * this whole module — it resolves a locale and a timezone database entry —
 * and doing it per call would be a real cost on a display that never reloads.
 */
const FLEET_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: FLEET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  // h23 rather than hour12:false. Both mean 24-hour, but hour12:false is
  // permitted to render midnight as "24" under some locale/engine
  // combinations, which would put 00:30 an entire day out.
  hourCycle: "h23",
});

/** Decimal hours (0-24) at the given instant, in the fleet's timezone. */
export function fleetHour(now: Date = new Date()): number {
  const parts = FLEET_CLOCK.formatToParts(now);

  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 12;

  return (hour % 24) + minute / 60;
}

/**
 * Which lighting phase the scene should render, from the clock in Kenya.
 *
 * Takes an explicit Date so it can be tested; callers in the app pass nothing
 * and get the current instant.
 */
export function timeOfDayInFleetZone(now: Date = new Date()): TimeOfDay {
  const hour = fleetHour(now);

  if (hour >= DAY_START && hour < DUSK_START) return "day";
  if ((hour >= DAWN_START && hour < DAY_START) || (hour >= DUSK_START && hour < NIGHT_START)) {
    return "dusk";
  }
  return "night";
}
