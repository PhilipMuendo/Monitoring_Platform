"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { FleetCurvePoint } from "@/lib/fleet-curve";

export interface FleetToday {
  /** Local (EAT) midnight the day started, ISO with offset. */
  day_start: string;
  bucket_minutes: number;
  points: FleetCurvePoint[];
  energy_today_kwh: number;
  /**
   * Yesterday up to the SAME clock time — the only fair baseline for a
   * percentage. See the field's doc comment in backend/internal/api/
   * fleet_today.go for why the full-day total is not it.
   */
  energy_yesterday_to_now_kwh: number;
  energy_yesterday_total_kwh: number;
}

/**
 * The fleet's day so far: generation curve plus the energy comparison.
 *
 * Polls on the collection cadence rather than faster. The series only changes
 * when a new 15-minute bucket closes, so a tighter interval would refetch the
 * same payload — and this runs all day on an unattended display.
 */
export function useFleetToday() {
  return useQuery({
    queryKey: ["fleet-today"],
    queryFn: () => api.get<FleetToday>("/api/v1/fleet/today"),
    refetchInterval: 5 * 60_000,
  });
}
