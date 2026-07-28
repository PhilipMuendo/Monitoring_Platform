"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { FleetSummary } from "@/lib/types";

export function useFleetSummary() {
  return useQuery({
    queryKey: ["fleet-summary"],
    queryFn: () => api.get<FleetSummary>("/api/v1/fleet/summary"),
    refetchInterval: 30_000,
  });
}
