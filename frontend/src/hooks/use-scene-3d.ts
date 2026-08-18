"use client";

import { useEffect, useSyncExternalStore } from "react";

import { webglTier } from "@/hooks/use-webgl-support";
import { currentConnection, shouldPrefetchScene } from "@/lib/scene-load-policy";

/**
 * Download state of the 3D power-flow scene.
 *
 *  - "idle"    nobody has asked for it yet
 *  - "loading" the chunk is on the wire
 *  - "ready"   it is in memory, so mounting the canvas is instant
 *  - "failed"  it could not be fetched — stay on the 2D diagram, permanently
 *
 * The scene is expensive to start: roughly 860 KB of three.js/r3f/drei in its
 * own chunk. On a first visit that is most of a second during which the panel
 * used to show a skeleton — a placeholder that carries no information at all,
 * even though the 2D diagram could have been drawn from the same summary
 * immediately.
 *
 * The chunk is effectively the whole of the wait. It used to be followed by a
 * 4 MB car model and a ~750 KB Draco decoder; the scene is entirely procedural
 * since that was removed. The one thing still fetched afterwards is the
 * ambient-occlusion pass (scene/ambient-occlusion.tsx), and nothing waits on
 * it — it resolves into an already-rendered scene.
 *
 * So the load is tracked out here rather than being hidden inside
 * next/dynamic's `loading` slot: `loading` renders a component that receives
 * no props, and the whole point is to render something that needs the summary.
 * Knowing the status explicitly also lets a failed chunk degrade to the 2D
 * view instead of tripping an error boundary on the wall display.
 */
export type Scene3DStatus = "idle" | "loading" | "ready" | "failed";

let status: Scene3DStatus = "idle";
const listeners = new Set<() => void>();

function setStatus(next: Scene3DStatus) {
  status = next;
  for (const listener of listeners) listener();
}

/**
 * Begins (or joins) the download. Safe to call repeatedly and from anywhere on
 * the client; the first call wins and the rest are no-ops.
 *
 * The specifier is deliberately identical to the one in the `dynamic()` call
 * in fleet-power-flow-view.tsx: two literal import()s of the same module
 * resolve to one module and one chunk, so what is warmed here is exactly what
 * renders there. It is written out in both places rather than shared through a
 * helper because Next reads the path out of the `dynamic()` arrow function to
 * apply ssr:false, and an indirection would hide it.
 *
 * Never call this during a server render — the module pulls in three.js, which
 * ssr:false exists to keep out of the server bundle entirely. Every caller
 * today is inside an effect, which is client-only.
 */
export function startScene3DLoad() {
  if (status !== "idle") return;
  // A device that cannot create a WebGL context renders the 2D diagram no
  // matter what the stored preference says, so downloading a scene it can
  // never use would be pure waste — and the device most likely to fail this is
  // the wall display's Smart TV browser, where bandwidth is scarcest. Left at
  // "idle" rather than marked failed: nothing was attempted, and the view
  // returns 2D on the tier check before it ever looks at this status.
  if (webglTier() === "none") return;
  setStatus("loading");
  import("@/components/dashboard/fleet-3d-power-flow").then(
    // Nothing to warm up after this resolves: the scene builds its geometry
    // procedurally and fetches no assets, so the chunk landing IS the scene
    // being ready. There was an asset preload step here while the car model
    // shipped. The ambient-occlusion chunk that loads afterwards is not
    // waited on by design — see fleet-3d-power-flow.tsx.
    () => setStatus("ready"),
    () => setStatus("failed"),
  );
}

/**
 * Speculative warm-up. Same chunk, same cache entry, weaker justification —
 * so it is allowed to decline. See lib/scene-load-policy.ts for the rules.
 *
 * WHY THIS EXISTS AT ALL: startScene3DLoad is reached through
 * usePowerFlowViewMode, which is called by the dashboard and wall pages —
 * both of which live behind RequireAuth. RequireAuth renders a spinner until
 * the auth context has finished its refresh call, so the chain was:
 *
 *     boot JS -> POST /auth/refresh -> render page -> read localStorage
 *              -> start downloading 860 KB
 *
 * An entire network round trip sat in FRONT of the largest asset on the site,
 * in series, for no reason: the scene chunk is public static JavaScript that
 * has nothing to do with who is signed in. Warming from above the auth gate
 * overlaps the two instead, which on a slow link is the single largest saving
 * available here — larger than anything left to win by shrinking the chunk,
 * which is mostly three.js and close to its floor already.
 *
 * Runs at idle so it never competes with the paint of whatever page the user
 * is actually on (frequently /login, where the download is pure free time
 * while they type).
 */
export function warmScene3D() {
  if (status !== "idle") return;

  // The whole decision runs at idle, the policy check included. Evaluating it
  // eagerly would run the WebGL probe — which creates and immediately
  // discards a real GL context — during the first paint of whatever page
  // mounted this, typically /login, where nothing 3D is on screen at all.
  const start = () => {
    if (
      shouldPrefetchScene({
        tier: webglTier(),
        connection: currentConnection(),
        viewportWidth: window.innerWidth,
      })
    ) {
      startScene3DLoad();
    }
  };

  if (typeof requestIdleCallback === "function") {
    // The timeout is the point: without it a permanently busy page never
    // reaches idle and the warm-up silently never happens.
    requestIdleCallback(start, { timeout: 2_000 });
  } else {
    // Safari has no requestIdleCallback. A macrotask still yields the first
    // paint, which is all this needs.
    setTimeout(start, 300);
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => status;
// The scene can never be loaded during a server render, and saying "idle"
// rather than probing keeps the snapshot stable across hydration.
const getServerSnapshot = (): Scene3DStatus => "idle";

/**
 * Subscribes to the scene's download state, starting it when `enabled`.
 *
 * `enabled` is a parameter rather than a call-site condition because this is a
 * hook: it has to be called unconditionally, but the chunk behind it should
 * only be fetched for someone who actually wants the 3D view.
 */
export function useScene3D(enabled: boolean): Scene3DStatus {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (enabled) startScene3DLoad();
  }, [enabled]);

  return current;
}
