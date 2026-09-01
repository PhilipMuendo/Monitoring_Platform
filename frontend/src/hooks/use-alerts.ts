"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { useLiveRefetchInterval } from "@/lib/stream-status";
import type { Alert, AlertHistoryPage } from "@/lib/types";

export function useActiveAlerts() {
  // Backs off to a slow safety net while the SSE stream is live, since the
  // stream already invalidates this key on every alert event.
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: ["alerts", "active"],
    queryFn: () => api.get<Alert[]>("/api/v1/alerts"),
    refetchInterval,
  });
}

/**
 * Fetches a page of the fleet-wide alert history (active AND resolved),
 * newest first — what the standalone /alerts page paginates through.
 * Mirrors useSitePage's {data, total, limit, offset} envelope pattern.
 */
export function useAlertHistory(opts: { limit?: number; offset?: number } = {}) {
  const { limit, offset } = opts;
  const refetchInterval = useLiveRefetchInterval();

  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  if (offset != null) params.set("offset", String(offset));
  const qs = params.toString();

  return useQuery({
    queryKey: ["alerts", "history", limit ?? null, offset ?? null],
    queryFn: () => api.get<AlertHistoryPage>(`/api/v1/alerts/history${qs ? `?${qs}` : ""}`),
    refetchInterval,
    // Keeps the previous page on screen while the next one loads, so paging
    // does not blank the table and jump the scroll position.
    placeholderData: (prev) => prev,
  });
}

export function useSiteAlerts(siteId: string | undefined) {
  return useQuery({
    queryKey: ["alerts", "site", siteId],
    queryFn: () => api.get<Alert[]>(`/api/v1/sites/${siteId}/alerts`),
    enabled: !!siteId,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => api.post<Alert>(`/api/v1/alerts/${alertId}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["sites"] });
      qc.invalidateQueries({ queryKey: ["fleet-summary"] });
    },
  });
}
