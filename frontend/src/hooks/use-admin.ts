"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Brand, Site, User } from "@/lib/types";

export interface CreateSiteInput {
  name: string;
  brand: Brand;
  brand_site_id: string;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  capacity_kw: number;
  installer_account_id?: string;
}

export interface UpdateSiteInput {
  name?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  capacity_kw?: number;
  is_active?: boolean;
}

function invalidateSites(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["sites"] });
  qc.invalidateQueries({ queryKey: ["fleet-summary"] });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSiteInput) => api.post<Site>("/api/v1/admin/sites", input),
    onSuccess: () => invalidateSites(qc),
  });
}

export function useUpdateSite(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSiteInput) => api.patch<Site>(`/api/v1/admin/sites/${id}`, input),
    onSuccess: () => {
      invalidateSites(qc);
      qc.invalidateQueries({ queryKey: ["site", id] });
    },
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/admin/sites/${id}`),
    onSuccess: () => invalidateSites(qc),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<User[]>("/api/v1/admin/users"),
  });
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<User>("/api/v1/admin/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

/**
 * The fleet-wide alert policy.
 *
 * Windows are stored and edited as SECONDS, not as counts of readings, so a
 * threshold means the same thing after POLL_INTERVAL is retuned. `derived`
 * carries the reading counts the backend converted them into, purely so the
 * form can show an operator what their duration actually became — see
 * alert-settings-form.tsx.
 */
export interface AlertSettings {
  production_drop_threshold_w: number;
  production_recover_threshold_w: number;
  production_drop_window_seconds: number;
  production_drop_cooldown_seconds: number;
  production_edge_margin_seconds: number;
  offline_threshold_seconds: number;
  offline_cooldown_seconds: number;
  fault_cooldown_seconds: number;
  battery_window_seconds: number;
  battery_soc_threshold_pct: number;
  battery_soc_recover_pct: number;
  battery_cooldown_seconds: number;
  updated_at: string;
  derived: {
    poll_interval_seconds: number;
    production_drop_window_readings: number;
    battery_window_readings: number;
  };
}

export function useAlertSettings() {
  return useQuery({
    queryKey: ["alert-settings"],
    queryFn: () => api.get<AlertSettings>("/api/v1/admin/alert-settings"),
  });
}

export function useUpdateAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    // PUT, not PATCH: several of these values are only valid relative to one
    // another (the two hysteresis bands, the windows against the poll
    // interval), so the whole policy is submitted and validated together.
    mutationFn: (input: Omit<AlertSettings, "updated_at" | "derived">) =>
      api.put<AlertSettings>("/api/v1/admin/alert-settings", input),
    onSuccess: (saved) => {
      // Seed the cache from the response rather than refetching: the backend
      // returns the stored row plus freshly derived reading counts, so this is
      // strictly more current than what a follow-up GET would race for.
      qc.setQueryData(["alert-settings"], saved);
      // Thresholds change which sites are alerting, so anything showing alerts
      // is now potentially stale.
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}
