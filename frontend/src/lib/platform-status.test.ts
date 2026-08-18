import { describe, expect, it } from "vitest";

import { platformStatus } from "@/lib/platform-status";
import type { FleetSummary, HealthResponse } from "@/lib/types";

const STALE_AFTER = 15 * 60;

function health(over: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: "healthy",
    timestamp: "2026-08-18T09:00:00Z",
    checks: { database: { ok: true }, collector: { ok: true } },
    metrics: {
      last_collection: "2026-08-18T09:00:00Z",
      total_sites: 20,
      success_rate: 1,
      avg_duration_ms: 4000,
      brands: {
        deye: { online: 6, offline: 1, unknown: 0 },
        ingecon: { online: 5, offline: 0, unknown: 0 },
        sosen: { online: 8, offline: 0, unknown: 0 },
      },
      alerts_active: 2,
      alerts_24h: 5,
    },
    ...over,
  };
}

function summary(ageSeconds = 60): FleetSummary {
  return { data_age_seconds: ageSeconds } as FleetSummary;
}

describe("platformStatus", () => {
  it("says nothing when the platform is healthy", () => {
    expect(platformStatus({ health: health(), summary: summary(), staleAfterSeconds: STALE_AFTER })).toBeNull();
  });

  // The case the wall used to get wrong: one vendor's API is failing, and
  // every one of its sites renders as offline as if the installations died.
  it("reports an unreachable vendor as unknown, explicitly not offline", () => {
    const h = health();
    h.metrics.brands.sosen = { online: 0, offline: 0, unknown: 8 };

    const issue = platformStatus({ health: h, summary: summary(), staleAfterSeconds: STALE_AFTER });

    expect(issue?.severity).toBe("warning");
    expect(issue?.headline).toBe("Sosen unreachable");
    expect(issue?.detail).toContain("8 sites are unknown, not offline");
  });

  it("names every unreachable vendor, worst first", () => {
    const h = health();
    h.metrics.brands.sosen = { online: 0, offline: 0, unknown: 8 };
    h.metrics.brands.ingecon = { online: 0, offline: 0, unknown: 2 };

    const issue = platformStatus({ health: h, summary: summary(), staleAfterSeconds: STALE_AFTER });

    expect(issue?.headline).toBe("Sosen and Ingecon unreachable");
    expect(issue?.detail).toContain("10 sites are unknown");
  });

  it("uses singular wording for a single unknown site", () => {
    const h = health();
    h.metrics.brands.deye = { online: 6, offline: 1, unknown: 1 };
    const issue = platformStatus({ health: h, summary: summary(), staleAfterSeconds: STALE_AFTER });
    expect(issue?.detail).toContain("1 site is unknown");
    expect(issue?.detail).toContain("this vendor's portal");
  });

  // Precedence matters: a stalled collector makes every brand look unreachable
  // at once, so reporting one brand would describe a symptom, not the cause.
  it("prefers a stalled collector over per-brand faults", () => {
    const h = health({ checks: { database: { ok: true }, collector: { ok: false } } });
    h.metrics.brands.sosen = { online: 0, offline: 0, unknown: 8 };

    const issue = platformStatus({ health: h, summary: summary(3600), staleAfterSeconds: STALE_AFTER });

    expect(issue?.headline).toBe("Collection has stalled");
    expect(issue?.detail).toContain("60 minutes");
    expect(issue?.detail).toContain("frozen, not zero");
  });

  it("prefers a database failure over everything", () => {
    const h = health({
      status: "unhealthy",
      checks: { database: { ok: false, error: "connection refused" }, collector: { ok: false } },
    });
    h.metrics.brands.sosen = { online: 0, offline: 0, unknown: 8 };

    const issue = platformStatus({ health: h, summary: summary(3600), staleAfterSeconds: STALE_AFTER });

    expect(issue?.severity).toBe("critical");
    expect(issue?.headline).toBe("Monitoring database unreachable");
  });

  // The behaviour the old standalone stale-data banner had, preserved.
  it("still warns on aged data even when health is unavailable", () => {
    const issue = platformStatus({
      health: undefined,
      summary: summary(20 * 60),
      staleAfterSeconds: STALE_AFTER,
    });
    expect(issue?.headline).toBe("Collection has stalled");
    expect(issue?.detail).toContain("20 minutes");
  });

  it("says nothing when neither source has loaded yet", () => {
    expect(
      platformStatus({ health: undefined, summary: undefined, staleAfterSeconds: STALE_AFTER }),
    ).toBeNull();
  });
});
