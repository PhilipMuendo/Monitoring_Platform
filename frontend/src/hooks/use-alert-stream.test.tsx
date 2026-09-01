import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAlertStream } from "@/hooks/use-alert-stream";
import { __resetStreamStatus, getStreamConnected } from "@/lib/stream-status";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiUrl: (path: string) => `http://api.test${path}`,
  getAccessToken: () => "token-123",
  refreshOnce: vi.fn(async () => "token-456"),
}));

/**
 * A controllable stand-in for the browser's EventSource. jsdom does not
 * implement one, and the behaviour under test is precisely the transitions —
 * open, error-while-connecting, error-after-close — that a real connection
 * would make it impossible to drive deterministically.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  closed = false;
  listeners = new Map<string, Set<(evt: MessageEvent) => void>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (evt: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (evt: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data?: unknown) {
    const evt = { data: data === undefined ? undefined : JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(evt);
  }
}

function Harness({ enabled = true }: { enabled?: boolean }) {
  useAlertStream(enabled);
  return null;
}

function renderStream(enabled = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness enabled={enabled} />
    </QueryClientProvider>,
  );
}

describe("useAlertStream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    __resetStreamStatus();
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("opens one connection carrying the access token", () => {
    renderStream();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/api/v1/alerts/stream?token=token-123");
  });

  it("opens no connection when disabled", () => {
    renderStream(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  // The polling hooks read this. If `open` did not flip it, every query would
  // keep polling at the full rate alongside a working stream — the redundancy
  // this wiring exists to remove.
  it("reports the stream as connected once it opens", () => {
    renderStream();
    expect(getStreamConnected()).toBe(false);

    act(() => FakeEventSource.instances[0].emit("open"));

    expect(getStreamConnected()).toBe(true);
  });

  // And the other direction: a stalled stream must not also mean stale data,
  // so an error resumes normal polling immediately.
  it("reports the stream as disconnected on any error", () => {
    renderStream();
    const es = FakeEventSource.instances[0];

    act(() => es.emit("open"));
    expect(getStreamConnected()).toBe(true);

    es.readyState = FakeEventSource.OPEN;
    act(() => es.emit("error"));

    expect(getStreamConnected()).toBe(false);
  });

  it("leaves a transiently-failing connection to the browser's own retry", () => {
    renderStream();
    const es = FakeEventSource.instances[0];
    es.readyState = FakeEventSource.CONNECTING;

    act(() => es.emit("error"));

    // Still one connection: we did not tear down and reopen behind the
    // browser's back.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.closed).toBe(false);
  });

  it("closes the connection and clears the flag on unmount", () => {
    const { unmount } = renderStream();
    const es = FakeEventSource.instances[0];
    act(() => es.emit("open"));

    unmount();

    expect(es.closed).toBe(true);
    expect(getStreamConnected()).toBe(false);
  });

  it("invalidates the alert, site and summary caches when an alert arrives", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );

    act(() =>
      FakeEventSource.instances[0].emit("alert.created", {
        id: "a1",
        severity: "critical",
        message: "Site offline",
        site_name: "Kibera Clinic",
      }),
    );

    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["alerts"]));
    expect(keys).toContain(JSON.stringify(["sites"]));
    expect(keys).toContain(JSON.stringify(["fleet-summary"]));
  });

  it("survives a malformed payload without tearing the stream down", () => {
    renderStream();
    const es = FakeEventSource.instances[0];

    act(() => {
      for (const fn of es.listeners.get("alert.created") ?? []) {
        fn({ data: "not json" } as MessageEvent);
      }
    });

    expect(es.closed).toBe(false);
  });
});
