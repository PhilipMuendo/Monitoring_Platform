"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Alert } from "@/lib/types";

export function useActiveAlerts() {
  return useQuery({
    queryKey: ["alerts", "active"],
    queryFn: () => api.get<Alert[]>("/api/v1/alerts"),
    refetchInterval: 30_000,
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
