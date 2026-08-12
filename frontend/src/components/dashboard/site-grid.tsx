"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteCard } from "@/components/dashboard/site-card";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSites } from "@/hooks/use-sites";
import type { SiteStatus } from "@/lib/types";

export function SiteGrid() {
  const { data: sites, isLoading } = useSites();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "all">("all");

  // Filtering trails the input rather than running per keystroke — see
  // useDebouncedValue. The <input> stays bound to `search`, so typing is
  // unaffected; only the grid re-render waits for the query to settle.
  const debouncedSearch = useDebouncedValue(search);

  const filtered = useMemo(() => {
    if (!sites) return [];
    const q = debouncedSearch.trim().toLowerCase();
    return sites.filter((site) => {
      if (statusFilter !== "all" && site.status !== statusFilter) return false;
      if (!q) return true;
      return site.name.toLowerCase().includes(q) || site.location.toLowerCase().includes(q);
    });
  }, [sites, debouncedSearch, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">
          Sites {sites ? <span className="text-muted-foreground">({filtered.length}/{sites.length})</span> : null}
        </h2>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search sites…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 sm:w-56"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SiteStatus | "all")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Fault</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No sites match your filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}
