"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { useLiveRefetchInterval } from "@/lib/stream-status";
import type { SitePage, SiteWithStatus } from "@/lib/types";

/**
 * Fetches a page of sites.
 *
 * The endpoint is paginated now, so the response is `{sites, total, limit,
 * offset}` rather than a bare array. `select` unwraps it back to an array
 * for the many callers that just want the list, while `useSitePage` below
 * exposes the envelope for anything that needs the total.
 *
 * The default limit deliberately covers a fleet several times the current
 * size — the point of paging here is to bound the worst case, not to make
 * every consumer implement a pager today.
 */
export function useSites(opts: { all?: boolean; limit?: number; offset?: number } = {}) {
  const page = useSitePage(opts);
  return { ...page, data: page.data?.sites };
}

export function useSitePage(opts: { all?: boolean; limit?: number; offset?: number } = {}) {
  const { all = false, limit, offset } = opts;
  const refetchInterval = useLiveRefetchInterval();

  const params = new URLSearchParams();
  if (all) params.set("all", "true");
  if (limit != null) params.set("limit", String(limit));
  if (offset != null) params.set("offset", String(offset));
  const qs = params.toString();

  return useQuery({
    queryKey: ["sites", all, limit ?? null, offset ?? null],
    queryFn: () => api.get<SitePage>(`/api/v1/sites${qs ? `?${qs}` : ""}`),
    refetchInterval,
  });
}

export function useSite(id: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: ["site", id],
    queryFn: () => api.get<SiteWithStatus>(`/api/v1/sites/${id}`),
    enabled: !!id,
    refetchInterval,
  });
}
