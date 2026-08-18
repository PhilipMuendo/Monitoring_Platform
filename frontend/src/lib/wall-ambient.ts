/**
 * How bright the wall display should be right now.
 *
 * The wall runs 24/7 in an office. Outside working hours nobody is reading it,
 * and a panel at full output all night is both the thing that ages it fastest
 * and, in a dark room, uncomfortably bright for anyone still there. Dimming
 * costs nothing and is trivially reversible — it is an overlay, not a change
 * to the data.
 *
 * Driven by the clock IN KENYA (lib/time-of-day.ts), not the viewer's, for the
 * same reason the 3D scene is: the wall hangs in the office it describes, and
 * a laptop previewing it from another timezone should see what the wall is
 * actually doing rather than what the viewer's evening looks like.
 *
 * Kept as a pure function of decimal hours so the boundary behaviour is
 * testable without mocking a clock.
 */

/** Full brightness between these hours. */
export const WALL_BRIGHT_FROM = 7;
export const WALL_BRIGHT_UNTIL = 19;

/**
 * Opacity of the black overlay at full dim.
 *
 * 0.4, not more: the display still has to be legible to someone walking past
 * at night, and to whoever is on site out of hours — which is precisely when
 * an alert matters most. This is dimming, not a screensaver.
 */
export const WALL_DIM_MAX = 0.4;

/**
 * Length of the fade at each boundary, in hours.
 *
 * A hard step at 19:00 reads as the screen glitching, and on a display people
 * see out of the corner of their eye that is exactly the kind of thing that
 * gets reported as a fault. An hour-long ramp is slower than anyone notices.
 */
const RAMP_HOURS = 1;

/** Overlay opacity, 0 (full brightness) to WALL_DIM_MAX, for a decimal hour. */
export function wallDimOpacity(fleetHour: number): number {
  if (!Number.isFinite(fleetHour)) return 0;
  const hour = ((fleetHour % 24) + 24) % 24;

  // Daytime plateau.
  if (hour >= WALL_BRIGHT_FROM && hour < WALL_BRIGHT_UNTIL) return 0;

  // Evening ramp down, 19:00 -> 20:00.
  if (hour >= WALL_BRIGHT_UNTIL && hour < WALL_BRIGHT_UNTIL + RAMP_HOURS) {
    return WALL_DIM_MAX * ((hour - WALL_BRIGHT_UNTIL) / RAMP_HOURS);
  }

  // Morning ramp up, 06:00 -> 07:00.
  if (hour >= WALL_BRIGHT_FROM - RAMP_HOURS && hour < WALL_BRIGHT_FROM) {
    return WALL_DIM_MAX * ((WALL_BRIGHT_FROM - hour) / RAMP_HOURS);
  }

  return WALL_DIM_MAX;
}
