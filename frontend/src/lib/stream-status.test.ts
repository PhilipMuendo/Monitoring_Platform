import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  POLL_INTERVAL_MS,
  POLL_INTERVAL_STREAMING_MS,
  __resetStreamStatus,
  getStreamConnected,
  setStreamConnected,
  subscribeStreamStatus,
} from "@/lib/stream-status";

describe("stream-status store", () => {
  beforeEach(() => {
    __resetStreamStatus();
  });

  it("starts disconnected", () => {
    expect(getStreamConnected()).toBe(false);
  });

  it("notifies subscribers when the connection state changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStreamStatus(listener);

    setStreamConnected(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStreamConnected()).toBe(true);

    setStreamConnected(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setStreamConnected(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // Without this guard every SSE `error` event — which fires on ordinary
  // transient drops too — would notify React and re-run every query hook.
  it("does not notify when set to the value it already holds", () => {
    const listener = vi.fn();
    subscribeStreamStatus(listener);

    setStreamConnected(false);
    expect(listener).not.toHaveBeenCalled();

    setStreamConnected(true);
    setStreamConnected(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps every subscriber informed", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeStreamStatus(a);
    subscribeStreamStatus(b);

    setStreamConnected(true);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  // Guards the direction of the backoff: reversed, a live stream would make
  // the app poll harder rather than softer, which is the bug this replaced.
  it("polls less often while streaming than while not", () => {
    expect(POLL_INTERVAL_STREAMING_MS).toBeGreaterThan(POLL_INTERVAL_MS);
  });
});
