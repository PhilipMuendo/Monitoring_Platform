"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { warmPowerFlowScene } from "@/hooks/use-power-flow-view-mode";
import { WALL_QUERY } from "@/components/layout/wall-size-gate";

/**
 * Renders nothing. Starts the 3D scene download as early as the page can.
 *
 * Mounted in Providers, which puts it ABOVE AuthProvider and above every
 * RequireAuth in the app. That placement is the entire point — see
 * warmPowerFlowScene for what was serialised behind the auth round trip
 * before, and lib/scene-load-policy.ts for when it declines to fetch at all.
 *
 * It runs on /login too, and that is intended rather than tolerated: the
 * seconds someone spends typing a password are the only genuinely free
 * bandwidth the app ever gets, and the page they are about to land on is the
 * dashboard.
 *
 * A component rather than a hook inside Providers so that mounting it stays a
 * visible, deletable line in the tree instead of a side effect buried in a
 * provider that is otherwise about React Query and themes.
 */
export function SceneWarmup() {
  const pathname = usePathname();

  useEffect(() => {
    // The one place the "above everything" placement works against itself.
    // WallSizeGate refuses to render the wall below 1280x640, so a phone
    // opening /wall gets a "too small" page — and would otherwise have
    // downloaded the entire scene to put behind it, because a stored "3d"
    // preference is explicit intent and skips the prefetch policy by design.
    //
    // Every other route renders the flow panel at any width, so this is
    // specifically about /wall rather than a general small-screen veto:
    // someone who chose 3D on their phone should still get it on the
    // dashboard.
    if (pathname === "/wall" && !window.matchMedia(WALL_QUERY).matches) return;

    warmPowerFlowScene();

    // Retry when the tab is first looked at.
    //
    // A page opened in a BACKGROUND tab reports window.innerWidth as 0, so the
    // prefetch policy reads it as a screen too small to bother with and
    // declines — which is the right call at that moment, since nobody is
    // looking. But the warm-up ran once on mount and never again, so the tab
    // stayed cold for the rest of its life and the user paid the full download
    // the first time they reached for the 3D view. Middle-clicking a link is
    // not an unusual way to open a dashboard.
    //
    // Both entry points are idempotent — the first call past "idle" wins and
    // the rest return immediately — so re-running costs nothing.
    const onVisible = () => {
      if (document.visibilityState === "visible") warmPowerFlowScene();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pathname]);

  return null;
}
