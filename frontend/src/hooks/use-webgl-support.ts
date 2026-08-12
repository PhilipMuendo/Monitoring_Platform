"use client";

import { useSyncExternalStore } from "react";

/**
 * How much 3D this browser can actually be trusted with.
 *
 *  - "none"  no WebGL context at all -> fall back to the 2D flow diagram.
 *  - "basic" WebGL1 only -> render the scene, but no postprocessing.
 *  - "full"  WebGL2 -> scene plus the ambient-occlusion pass.
 *
 * The wall display runs in a Smart TV's built-in browser, where support
 * ranges from good to absent by model and firmware. Two distinct failures to
 * avoid there: a device that cannot create a context renders the 3D panel as
 * a blank rectangle (on an unattended screen that reads as "the monitoring
 * system is broken"), and a device that *can* create a context but crawls
 * through a postprocessing pass turns a live dashboard into a slideshow.
 *
 * WebGL2 is the gate for effects because the AO pass depends on float render
 * targets and depth sampling that WebGL1 only exposes patchily. It is a
 * necessary condition, not a sufficient one — a TV may report WebGL2 and
 * still be far too slow — so the scene additionally demotes itself at runtime
 * if measured frame rate declines. See PerformanceMonitor in
 * fleet-3d-power-flow.tsx.
 */
export type WebGLTier = "none" | "basic" | "full";

// Probed once per page load: creating contexts is not free, and browsers cap
// how many can exist at a time. Caching also keeps getSnapshot below stable,
// which useSyncExternalStore requires — returning a freshly computed value
// each call would spin React in a re-render loop.
let cached: WebGLTier | null = null;

function probe(): WebGLTier {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl2 = canvas.getContext("webgl2");
    const gl = gl2 ?? canvas.getContext("webgl");
    if (!gl) {
      cached = "none";
      return cached;
    }
    // Hand the context straight back. Browsers allow only a handful
    // simultaneously (commonly 8-16) and the real scene needs one of them —
    // a probe that holds onto its context can starve the thing it was
    // checking for.
    const loseContext = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    loseContext?.loseContext();
    cached = gl2 ? "full" : "basic";
    return cached;
  } catch {
    cached = "none";
    return cached;
  }
}

// GPU capability cannot change for the life of the document, so there is
// nothing to subscribe to — but useSyncExternalStore is still the right hook
// rather than useState + useEffect. It is the supported way to read a
// browser-only value with an explicit server snapshot: probing in an effect
// and calling setState trips react-hooks/set-state-in-effect, and probing in
// a lazy useState initialiser would desync hydration.
const subscribe = () => () => {};
const getSnapshot = () => probe();
// document does not exist during the server render, so report "still
// unknown" and let the client resolve it on hydration.
const getServerSnapshot = () => null;

/** null before hydration resolves it, then the verdict. */
export function useWebGLTier(): WebGLTier | null {
  return useSyncExternalStore<WebGLTier | null>(subscribe, getSnapshot, getServerSnapshot);
}
