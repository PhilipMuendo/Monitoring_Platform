"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { FLEET_REFETCH_INTERVAL_MS } from "@/lib/constants";
import type { SiteWithStatus } from "@/lib/types";

export function useSites(opts: { all?: boolean } = {}) {
  const all = opts.all ?? false;
  return useQuery({
    queryKey: ["sites", all],
    queryFn: () => api.get<SiteWithStatus[]>(`/api/v1/sites${all ? "?all=true" : ""}`),
    refetchInterval: FLEET_REFETCH_INTERVAL_MS,
  });
}

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: ["site", id],
    queryFn: () => api.get<SiteWithStatus>(`/api/v1/sites/${id}`),
    enabled: !!id,
    refetchInterval: FLEET_REFETCH_INTERVAL_MS,
  });
}
