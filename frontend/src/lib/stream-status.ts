"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the alert SSE stream is currently connected.
 *
 * Lives in module scope rather than context because the writer
 * (use-alert-stream) and the readers (the polling query hooks) sit in
 * unrelated parts of the tree, and threading a provider between them would
 * buy nothing — there is exactly one stream per document.
 *
 * WHY IT EXISTS. The app had push and pull running at full rate
 * simultaneously: the stream invalidates alerts/sites/fleet-summary on every
 * event, while six hooks also polled on 30s timers. On the wall display —
 * unattended, 24/7 — that was thousands of redundant requests a day whose
 * results the stream had already delivered. Polling is now a safety net for
 * a stream that has died quietly, not the primary transport, so it backs
 * right off whenever the stream is known to be up.
 */

let connected = false;
const listeners = new Set<() => void>();

export function setStreamConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}

/**
 * Registers a listener for connection-state changes. Exported because it is
 * the store's real contract — React consumes it through useSyncExternalStore,
 * and tests subscribe to it directly rather than through a rendered hook.
 */
export function subscribeStreamStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current value, without subscribing. */
export function getStreamConnected() {
  return connected;
}

export function useStreamConnected(): boolean {
  return useSyncExternalStore(
    subscribeStreamStatus,
    () => connected,
    // The server has no stream, so it reports disconnected. That is the
    // conservative direction: the hydrating client polls at the normal rate
    // until the stream actually opens.
    () => false,
  );
}

/** Normal polling cadence, used when nothing is pushing updates. */
export const POLL_INTERVAL_MS = 30_000;

/**
 * Cadence while the stream is live. Long enough that it costs nothing over a
 * day on a wall display, short enough to repair a stream that is open at the
 * socket level but no longer delivering.
 */
export const POLL_INTERVAL_STREAMING_MS = 5 * 60_000;

/**
 * The refetchInterval a live-data query should use right now.
 *
 * @param base cadence to use when the stream is down (defaults to 30s)
 */
export function useLiveRefetchInterval(base: number = POLL_INTERVAL_MS): number {
  const streaming = useStreamConnected();
  return streaming ? Math.max(base, POLL_INTERVAL_STREAMING_MS) : base;
}

/** Test seam: resets module state between test cases. */
export function __resetStreamStatus() {
  connected = false;
  listeners.clear();
}
