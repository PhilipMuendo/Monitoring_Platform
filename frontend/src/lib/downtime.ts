/**
 * How long a site has been silent, for the wall's "Needs Attention" list.
 *
 * "Offline" on its own is not actionable. A site that stopped reporting twenty
 * minutes ago is probably a flaky connection that will come back on the next
 * cycle; the same site silent for three days is a truck roll. The wall listed
 * both identically, so the list told you WHICH sites were unhappy but nothing
 * about which one to deal with first — and on a screen with no interaction,
 * that ordering signal is the only triage anyone gets.
 *
 * Separate from formatRelativeTime in lib/format.ts on purpose. That renders
 * "4h ago" for a timestamp in prose; this renders a duration as a compact
 * badge and, more importantly, grades it. Reusing the prose formatter would
 * have meant no tier, which is the half that changes behaviour.
 */

export type DowntimeTier = "recent" | "hours" | "days" | "unknown";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Grades an outage.
 *
 *   recent   under an hour — very likely a transient poll failure
 *   hours    under a day   — a real fault, same working day
 *   days     a day or more — nobody has acted on this
 *   unknown  never reported, or an unparseable timestamp
 *
 * A site that has NEVER reported is deliberately "unknown" rather than the
 * worst tier. It is usually a site registered minutes ago whose first poll has
 * not run, not a three-year outage, and rendering it as the most urgent thing
 * on the wall would bury the sites that actually stopped.
 */
export function downtimeTier(lastSeenISO: string | null | undefined, now: number = Date.now()): DowntimeTier {
  if (!lastSeenISO) return "unknown";
  const then = new Date(lastSeenISO).getTime();
  if (!Number.isFinite(then)) return "unknown";

  // A future timestamp means clock skew between the vendor, us and this
  // browser. Treated as "just now" rather than producing a negative duration.
  const elapsed = Math.max(0, now - then);
  if (elapsed >= DAY) return "days";
  if (elapsed >= HOUR) return "hours";
  return "recent";
}

/**
 * Compact duration for a badge: "8m", "4h", "3d".
 *
 * Deliberately coarse. One significant figure is all that is readable at four
 * metres, and "3d" and "3d 4h" prompt exactly the same action.
 */
export function downtimeLabel(lastSeenISO: string | null | undefined, now: number = Date.now()): string {
  if (!lastSeenISO) return "no data yet";
  const then = new Date(lastSeenISO).getTime();
  if (!Number.isFinite(then)) return "no data yet";

  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}

/** Tailwind classes for each tier, escalating in weight rather than hue. */
export const DOWNTIME_CLASS: Record<DowntimeTier, string> = {
  recent: "text-muted-foreground",
  hours: "text-status-warning",
  days: "text-status-critical font-semibold",
  unknown: "text-muted-foreground",
};
