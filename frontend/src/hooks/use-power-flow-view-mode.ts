"use client";

import { useEffect, useState } from "react";

import { startScene3DLoad, warmScene3D } from "@/hooks/use-scene-3d";

export type PowerFlowViewMode = "2d" | "3d";

const STORAGE_KEY = "power-flow-view-mode";

/** The stored choice, or null when this browser has never expressed one. */
export function readStoredViewMode(): PowerFlowViewMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "2d" || stored === "3d" ? stored : null;
  } catch {
    // Safari in private mode throws on localStorage access. A missing
    // preference is a perfectly good answer, and it is not worth taking the
    // app down over.
    return null;
  }
}

/**
 * Starts fetching the 3D scene as early in the page's life as possible,
 * from ABOVE the auth gate.
 *
 * Three cases, and they are deliberately not the same:
 *
 *   "3d" stored  — the user has chosen 3D on this device. Explicit intent:
 *                  fetch now, vetoed only by a device with no WebGL at all.
 *
 *   nothing stored — a first visit. Fetch SPECULATIVELY, subject to
 *                  lib/scene-load-policy.ts, which declines on phones, on
 *                  Save-Data and on 2g. This is the bet that makes the 3D
 *                  toggle (and, next, the per-site scenes) feel instant the
 *                  first time anyone reaches for them. It is a bet: on a
 *                  desktop that never presses the toggle it costs ~370 KB of
 *                  idle-time bandwidth. If that ever stops looking worth it,
 *                  this is the branch to delete — the other two are not
 *                  speculative and should stay.
 *
 *   "2d" stored  — they have seen the 3D view and turned it off. Downloading
 *                  it anyway would be spending their bandwidth to contradict
 *                  a decision they already made. Do nothing.
 */
export function warmPowerFlowScene() {
  const stored = readStoredViewMode();
  if (stored === "3d") {
    startScene3DLoad();
  } else if (stored === null) {
    warmScene3D();
  }
}

// Starts at a fixed default ("2d") on both server and client to avoid a
// hydration mismatch, then reconciles with localStorage post-mount — the
// same category of one-time "flash" tradeoff next-themes already has in
// this app (see the suppressHydrationWarning on <html> in layout.tsx).
export function usePowerFlowViewMode() {
  const [mode, setModeState] = useState<PowerFlowViewMode>("2d");

  useEffect(() => {
    // Deferred via queueMicrotask (rather than an early synchronous
    // setState) so the state update reads as a reaction to checking
    // localStorage, not a direct side effect of mounting — see the same
    // pattern/rationale in lib/auth-context.tsx.
    queueMicrotask(() => {
      const stored = readStoredViewMode();
      if (stored) setModeState(stored);
    });
  }, []);

  // Warm the 3D bundle the moment we know it is wanted, rather than when the
  // panel first renders.
  //
  // This hook is called at the top of the dashboard and wall pages, but the
  // flow panel below only mounts once the fleet summary has come back from the
  // API — so leaving the kickoff to the panel put a network round-trip in
  // series ahead of the scene chunk, which depends on none of it. Starting
  // here overlaps the two. Cheap and idempotent; it does nothing at all for
  // someone whose preference is 2D.
  //
  // Usually a no-op by the time it runs: SceneWarmup calls
  // warmPowerFlowScene() from above the auth gate, which is earlier still.
  // This stays because it is the path that covers a toggle DURING the
  // session, which no amount of warming at boot can predict.
  useEffect(() => {
    if (mode === "3d") startScene3DLoad();
  }, [mode]);

  function setMode(next: PowerFlowViewMode) {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private-mode Safari. The choice still applies for this session; it
      // just will not be remembered, which beats throwing out of a click.
    }
  }

  return { mode, setMode };
}
