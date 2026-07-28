"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiUrl, getAccessToken } from "@/lib/api-client";
import type { Alert } from "@/lib/types";

// Live-updates the issues panel over SSE instead of waiting for the next
// 30s poll. Browsers' EventSource can't set an Authorization header, so
// the access token rides along as a query param (validated once at
// connect time by the backend — see api.Deps.withStreamAuth).
export function useAlertStream(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const token = getAccessToken();
    if (!token) return;

    const es = new EventSource(apiUrl(`/api/v1/alerts/stream?token=${encodeURIComponent(token)}`));

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

    es.addEventListener("alert.created", onCreated);
    es.addEventListener("alert.resolved", invalidate);
    es.addEventListener("alert.acknowledged", invalidate);

    return () => {
      es.removeEventListener("alert.created", onCreated);
      es.removeEventListener("alert.resolved", invalidate);
      es.removeEventListener("alert.acknowledged", invalidate);
      es.close();
    };
  }, [enabled, qc]);
}
