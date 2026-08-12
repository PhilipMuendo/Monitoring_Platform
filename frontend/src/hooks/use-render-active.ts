"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a WebGL canvas is worth spending frames on: the tab is visible AND
 * the element is at least near the viewport.
 *
 * The 3D power-flow canvas has no `frameloop` bound of its own, so it drives
 * requestAnimationFrame at 60fps for as long as it is mounted — including
 * while the operator has scrolled down to the site grid and the panel is
 * nowhere on screen. Browsers throttle rAF in *backgrounded tabs*, but not in
 * a foreground tab whose content happens to be scrolled out of view, and the
 * office wall display is never backgrounded at all.
 *
 * Returns true when unsupported or unobservable, so the scene renders rather
 * than staying frozen if IntersectionObserver is missing.
 */
export function useRenderActive(ref: RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = ref.current;
    let onScreen = true;
    let tabVisible = document.visibilityState === "visible";
    const sync = () => setActive(onScreen && tabVisible);

    const onVisibility = () => {
      tabVisible = document.visibilityState === "visible";
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let observer: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          onScreen = entries.some((entry) => entry.isIntersecting);
          sync();
        },
        // Resume slightly before the panel scrolls back in, so it is already
        // animating by the time it is actually visible rather than starting
        // frozen for a frame.
        { rootMargin: "150px" },
      );
      observer.observe(el);
    }

    sync();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [ref]);

  return active;
}
