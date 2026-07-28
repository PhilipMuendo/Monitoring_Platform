"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { SiteWithStatus } from "@/lib/types";

export function useSites(opts: { all?: boolean } = {}) {
  const all = opts.all ?? false;
  return useQuery({
    queryKey: ["sites", all],
    queryFn: () => api.get<SiteWithStatus[]>(`/api/v1/sites${all ? "?all=true" : ""}`),
    refetchInterval: 30_000,
  });
}

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: ["site", id],
    queryFn: () => api.get<SiteWithStatus>(`/api/v1/sites/${id}`),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}
