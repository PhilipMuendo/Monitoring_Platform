"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { FLEET_REFETCH_INTERVAL_MS } from "@/lib/constants";
import type { FleetSummary } from "@/lib/types";

export function useFleetSummary() {
  return useQuery({
    queryKey: ["fleet-summary"],
    queryFn: () => api.get<FleetSummary>("/api/v1/fleet/summary"),
    refetchInterval: FLEET_REFETCH_INTERVAL_MS,
  });
}
