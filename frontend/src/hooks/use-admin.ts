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
