"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { useLiveRefetchInterval } from "@/lib/stream-status";
import type { FleetSummary } from "@/lib/types";

export function useFleetSummary() {
  // The SSE stream invalidates this key on every alert event, so polling is
  // only here to catch changes the stream cannot see (a site coming back
  // online quietly) and to repair a stream that has stalled.
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: ["fleet-summary"],
    queryFn: () => api.get<FleetSummary>("/api/v1/fleet/summary"),
    refetchInterval,
  });
}
