"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiUrl, getAccessToken, refreshOnce } from "@/lib/api-client";
import type { Alert } from "@/lib/types";

const RECONNECT_DELAY_MS = 3000;

// Live-updates the issues panel over SSE instead of waiting for the next
// 30s poll. Browsers' EventSource can't set an Authorization header, so
// the access token rides along as a query param (validated once at
// connect time by the backend — see api.Deps.withStreamAuth).
export function useAlertStream(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["sites"] });
      qc.invalidateQueries({ queryKey: ["fleet-summary"] });
    };

    const onCreated = (evt: MessageEvent) => {
      invalidate();
      try {
        const alert = JSON.parse(evt.data) as Alert;
        const notify = alert.severity === "critical" ? toast.error : toast.warning;
        notify(alert.message, { description: alert.site_name });
      } catch {
        // ignore malformed payloads
      }
    };

    const teardown = () => {
      if (!es) return;
      es.removeEventListener("alert.created", onCreated);
      es.removeEventListener("alert.resolved", invalidate);
      es.removeEventListener("alert.acknowledged", invalidate);
      es.removeEventListener("error", onError);
      es.close();
      es = null;
    };

    // A dropped network connection leaves the browser retrying on its own
    // (readyState CONNECTING) — nothing to do there. But the connect-time
    // token in the URL expires roughly every JWT_ACCESS_TTL, and once the
    // backend rejects a connection outright the browser does not retry
    // (readyState goes CLOSED for good) — that silently killed live
    // alerts after the first token expiry until this fix. Refresh the
    // token and open a fresh connection ourselves in that case.
    const onError = () => {
      if (es?.readyState !== EventSource.CLOSED) return;
      teardown();
      if (cancelled) return;
      reconnectTimer = setTimeout(async () => {
        await refreshOnce();
        if (!cancelled) connect();
      }, RECONNECT_DELAY_MS);
    };

    const connect = () => {
      const token = getAccessToken();
      if (!token) return;

      es = new EventSource(apiUrl(`/api/v1/alerts/stream?token=${encodeURIComponent(token)}`));
      es.addEventListener("alert.created", onCreated);
      es.addEventListener("alert.resolved", invalidate);
      es.addEventListener("alert.acknowledged", invalidate);
      es.addEventListener("error", onError);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      teardown();
    };
  }, [enabled, qc]);
}
