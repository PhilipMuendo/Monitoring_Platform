import { describe, expect, it } from "vitest";

import {
  SCENE_PREFETCH_MIN_WIDTH,
  shouldPrefetchScene,
  type ScenePrefetchInput,
} from "@/lib/scene-load-policy";

/** A desktop on a good connection: the one case that should say yes. */
function desktop(overrides: Partial<ScenePrefetchInput> = {}): ScenePrefetchInput {
  return { tier: "full", connection: { effectiveType: "4g" }, viewportWidth: 1440, ...overrides };
}

describe("shouldPrefetchScene", () => {
  it("prefetches on a capable desktop", () => {
    expect(shouldPrefetchScene(desktop())).toBe(true);
  });

  it("prefetches on the basic WebGL1 tier too", () => {
    // The tier decides whether the ambient-occlusion pass loads, not whether
    // the scene itself can run. A WebGL1 device still renders it.
    expect(shouldPrefetchScene(desktop({ tier: "basic" }))).toBe(true);
  });

  it("never prefetches without WebGL — the bytes could not be used", () => {
    expect(shouldPrefetchScene(desktop({ tier: "none" }))).toBe(false);
  });

  it("treats an unresolved tier as 'not yet', not as 'yes'", () => {
    // null is the pre-hydration probe. Guessing true here would fetch on
    // devices the WebGL veto exists to protect.
    expect(shouldPrefetchScene(desktop({ tier: null }))).toBe(false);
  });

  it("honours Save-Data even on a wide screen and a fast link", () => {
    expect(
      shouldPrefetchScene(desktop({ connection: { saveData: true, effectiveType: "4g" } })),
    ).toBe(false);
  });

  it("declines on 2g and slow-2g", () => {
    for (const effectiveType of ["2g", "slow-2g"]) {
      expect(shouldPrefetchScene(desktop({ connection: { effectiveType } }))).toBe(false);
    }
  });

  it("allows 3g — slow is not the same as metered", () => {
    expect(shouldPrefetchScene(desktop({ connection: { effectiveType: "3g" } }))).toBe(true);
  });

  it("declines below the phone/tablet threshold and allows at it", () => {
    expect(shouldPrefetchScene(desktop({ viewportWidth: SCENE_PREFETCH_MIN_WIDTH - 1 }))).toBe(false);
    expect(shouldPrefetchScene(desktop({ viewportWidth: SCENE_PREFETCH_MIN_WIDTH }))).toBe(true);
  });

  it("prefetches when the browser exposes no connection info at all", () => {
    // Safari and Firefox have no navigator.connection. Missing information
    // must not be read as a veto, or those browsers never prefetch.
    expect(shouldPrefetchScene(desktop({ connection: undefined }))).toBe(true);
  });
});
