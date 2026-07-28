"use client";

import { useEffect, useState } from "react";

export type PowerFlowViewMode = "2d" | "3d";

const STORAGE_KEY = "power-flow-view-mode";

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
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "2d" || stored === "3d") setModeState(stored);
    });
  }, []);

  function setMode(next: PowerFlowViewMode) {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return { mode, setMode };
}
