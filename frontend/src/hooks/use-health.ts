"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { useLiveRefetchInterval } from "@/lib/stream-status";
import type { HealthResponse } from "@/lib/types";

export function useHealth() {
  // 60s base rather than 30s: this is a liveness probe, not fleet telemetry.
  const refetchInterval = useLiveRefetchInterval(60_000);
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthResponse>("/health"),
    refetchInterval,
  });
}
