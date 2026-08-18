import type { FleetSummary, HealthResponse } from "@/lib/types";

/**
 * What the wall should say about the MONITORING PLATFORM, as distinct from
 * the fleet.
 *
 * THE PROBLEM THIS SOLVES. On a live fleet of 20 sites, 9 were showing as
 * offline or "no data" on the wall. Nothing was wrong with 9 installations:
 * one vendor's API was rejecting our TLS handshake and another had not
 * published today's samples yet. Read from across a room, that is
 * indistinguishable from half the fleet going dark overnight — and it is the
 * difference between phoning a technician and phoning nobody.
 *
 * The backend already models the distinction. /health reports per-brand
 * online/offline/**unknown**, where unknown means "we could not read this
 * site", and the chat assistant is explicitly prompted to use it. The wall was
 * the one surface that ignored it.
 *
 * Returned as data rather than rendered here so the precedence is testable
 * without a DOM: which of several simultaneous problems gets the one banner is
 * the actual logic, and it is easy to get subtly wrong.
 */

export type PlatformSeverity = "warning" | "critical";

export interface PlatformIssue {
  severity: PlatformSeverity;
  /** Short enough to read at four metres. */
  headline: string;
  /** One clarifying sentence. */
  detail: string;
}

export interface PlatformStatusInput {
  health: HealthResponse | undefined;
  summary: FleetSummary | undefined;
  /** Age at which the collection pipeline counts as stalled. */
  staleAfterSeconds: number;
}

/** Brand ids are lowercase on the wire; the wall shows them capitalised. */
function brandLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The single most important thing wrong with the platform right now, or null.
 *
 * ONE banner, not a stack. A wall display has no scrollback and nobody
 * standing at it, so three simultaneous warnings compete for the same glance
 * and the reader takes away none of them. Precedence, worst first:
 *
 *   1. The database is unreachable — nothing else on screen can be trusted,
 *      including the numbers that look fine.
 *   2. Collection has stalled — every reading is frozen at whatever it was.
 *      Checked before per-brand faults because a stalled collector explains
 *      them all at once.
 *   3. A vendor is unreachable — some sites are unknown, NOT offline.
 *   4. Data is merely ageing — the pre-existing stale-data warning.
 */
export function platformStatus({
  health,
  summary,
  staleAfterSeconds,
}: PlatformStatusInput): PlatformIssue | null {
  // 1. Database. `status` alone is not enough: a 503 response may not be
  // parsed into `health` at all, so an absent health object with a stale
  // summary still falls through to the collection checks below.
  if (health?.checks?.database && !health.checks.database.ok) {
    return {
      severity: "critical",
      headline: "Monitoring database unreachable",
      detail: "Readings on this screen are the last ones we could load and are not updating.",
    };
  }

  // 2. Collector. Either the backend says so, or the freshest reading
  // fleet-wide has aged past the threshold.
  const collectorStalled = health?.checks?.collector?.ok === false;
  const dataAged = summary != null && summary.data_age_seconds > staleAfterSeconds;
  if (collectorStalled || dataAged) {
    const minutes = summary ? Math.round(summary.data_age_seconds / 60) : null;
    return {
      severity: "critical",
      headline: "Collection has stalled",
      detail: minutes
        ? `No new readings for ${minutes} minutes. Site figures below are frozen, not zero.`
        : "The collector has not completed a cycle recently. Site figures below are frozen, not zero.",
    };
  }

  // 3. Per-brand reachability. This is the case the wall used to misreport.
  const brands = health?.metrics?.brands ?? {};
  const unreachable = Object.entries(brands)
    .filter(([, b]) => (b.unknown ?? 0) > 0)
    .sort((a, b) => (b[1].unknown ?? 0) - (a[1].unknown ?? 0));

  if (unreachable.length > 0) {
    const sites = unreachable.reduce((n, [, b]) => n + (b.unknown ?? 0), 0);
    const names = unreachable.map(([id]) => brandLabel(id));
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return {
      severity: "warning",
      headline: `${who} unreachable`,
      // The second sentence is the entire point of the banner. Without it a
      // reader still concludes the sites are down.
      detail: `${plural(sites, "site is", "sites are")} unknown, not offline — we cannot read ${
        names.length === 1 ? "this vendor's portal" : "these vendors' portals"
      }, so their generation is unmeasured rather than zero.`,
    };
  }

  return null;
}
