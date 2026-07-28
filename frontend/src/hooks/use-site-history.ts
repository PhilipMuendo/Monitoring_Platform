"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { SiteHistory } from "@/lib/types";

export function useSiteHistory(id: string | undefined, range: "24h" | "7d" | "30d") {
  return useQuery({
    queryKey: ["site-history", id, range],
    queryFn: () => api.get<SiteHistory>(`/api/v1/sites/${id}/history?range=${range}`),
    enabled: !!id,
  });
}
