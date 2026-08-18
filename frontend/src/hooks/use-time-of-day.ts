"use client";

import { useSyncExternalStore } from "react";

import { timeOfDayInFleetZone } from "@/lib/time-of-day";
import type { TimeOfDay } from "@/lib/power-flow-colors";

/**
 * How often the clock is re-read.
 *
 * The phases are steps, not a continuous ramp, so the only thing this interval
 * costs is how late a transition can be — at worst five minutes, on a boundary
 * that is itself an approximation of sunset. Polling faster would be spending
 * wake-ups on a value that changes four times a day.
 *
 * It polls rather than scheduling a single timer to the next boundary because
 * the wall display runs for weeks: a long setTimeout is exactly what a browser
 * throttles, coalesces or drops when a tab is backgrounded or a machine
 * suspends, and one missed timer would leave the panel in daylight all night.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// An external store rather than useState + useEffect, matching use-scene-3d.ts
// and use-webgl-support.ts. Two things fall out of it that the effect version
// did not have:
//
//   - Subscribers are notified only when the phase actually CHANGES, so this
//     re-renders the scene four times a day rather than 288 times.
//   - The clock is read once per tick for the whole app, not once per render
//     per consumer. getSnapshot has to be cheap; formatting a date through
//     Intl on every render of a 3D scene is not.

let current: TimeOfDay | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  const next = timeOfDayInFleetZone();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (listeners.size === 1) {
    timer = setInterval(refresh, CHECK_INTERVAL_MS);
    // Also re-read whenever the page becomes visible again. This is the case
    // the interval alone handles badly: a laptop closed at 17:00 and reopened
    // at 21:00 has had its timers suspended, and this fires on the frame the
    // tab comes back rather than up to five minutes later.
    document.addEventListener("visibilitychange", refresh);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", refresh);
    }
  };
}

function getSnapshot(): TimeOfDay {
  // Lazily seeded, then only ever updated by refresh(). Returning a cached
  // value is what keeps this safe to call on every render.
  if (current === null) current = timeOfDayInFleetZone();
  return current;
}

// The scene is loaded with ssr:false and never renders on the server, so this
// exists to satisfy the signature rather than to be correct — but "day" is the
// honest default for a snapshot taken with no clock available.
const getServerSnapshot = (): TimeOfDay => "day";

/**
 * The scene's current lighting phase, from the clock in Kenya.
 *
 * Deliberately not the viewer's clock — see FLEET_TIME_ZONE in
 * lib/time-of-day.ts for why that distinction matters here.
 */
export function useTimeOfDay(): TimeOfDay {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
