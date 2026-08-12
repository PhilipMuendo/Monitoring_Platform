"use client";

import { useEffect, useState } from "react";

import { nextReadyIndex, readyCount, resolveActiveIndex, type RotatingPage } from "@/lib/wall-rotation";

/**
 * Advances the wall display through its pages, skipping any with nothing to
 * show. Returns the index that should be on screen.
 *
 * Per-page dwell rather than one global interval: a page carrying its own
 * inner rotation (the Overview's "Needs Attention" list pages every 8s) needs
 * longer than a static one, or the wall cuts away mid-cycle and the later
 * entries are never seen.
 *
 * Rotation stops entirely when fewer than two pages are ready — a single-page
 * wall should hold still, not tick against itself once per dwell.
 */
export function useWallRotation(pages: readonly RotatingPage[]): number {
  const [index, setIndex] = useState(0);

  // `pages` is a fresh array on every render — its ready flags derive from
  // polled data, so useSites returning a new identity every 30s rebuilds it.
  // The dwell effect therefore depends only on PRIMITIVES. Depending on the
  // array itself would restart the timer on each poll, and since the Overview
  // dwell (40s) is longer than the poll interval (30s) it would be cancelled
  // and restarted forever — the wall would never advance at all.
  const readyKey = pages.map((p) => (p.ready ? "1" : "0")).join("");

  const active = resolveActiveIndex(pages, index);
  const dwellMs = pages[active]?.dwellMs;

  useEffect(() => {
    if (dwellMs == null) return;
    // Rebuilt from readyKey rather than captured from `pages`, which keeps the
    // effect free of non-primitive dependencies while still routing the
    // skip-empty decision through the tested helpers in lib/wall-rotation.
    const flags: RotatingPage[] = Array.from(readyKey, (c, i) => ({
      id: String(i),
      ready: c === "1",
      dwellMs: 0,
    }));
    if (readyCount(flags) < 2) return;

    const id = setTimeout(() => setIndex(nextReadyIndex(flags, active)), dwellMs);
    return () => clearTimeout(id);
  }, [active, readyKey, dwellMs]);

  return active;
}
