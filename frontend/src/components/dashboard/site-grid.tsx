"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteRow } from "@/components/dashboard/site-card";
import { useSites } from "@/hooks/use-sites";
import type { SiteStatus } from "@/lib/types";

export function SiteGrid() {
  const { data: sites, isLoading } = useSites();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "all">("all");

  const filtered = useMemo(() => {
    if (!sites) return [];
    const q = search.trim().toLowerCase();
    return sites.filter((site) => {
      if (statusFilter !== "all" && site.status !== statusFilter) return false;
      if (!q) return true;
      return site.name.toLowerCase().includes(q) || site.location.toLowerCase().includes(q);
    });
  }, [sites, search, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="label-caps text-xs font-semibold text-muted-foreground">
          Sites {sites ? <span>({filtered.length}/{sites.length})</span> : null}
        </h2>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search sites…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full pl-7 text-xs sm:w-56"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SiteStatus | "all")}>
            <SelectTrigger className="h-7 w-32 text-xs">
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
        <div className="space-y-1">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-border py-10 text-center text-sm text-muted-foreground">No sites match your filters.</div>
      ) : (
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="label-caps w-8 text-[10px]"></TableHead>
                <TableHead className="label-caps text-[10px]">Site</TableHead>
                <TableHead className="label-caps text-[10px]">Brand</TableHead>
                <TableHead className="label-caps text-right text-[10px]">Output</TableHead>
                <TableHead className="label-caps text-[10px]">Battery</TableHead>
                <TableHead className="label-caps text-right text-[10px]">Capacity</TableHead>
                <TableHead className="label-caps text-right text-[10px]">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((site) => (
                <SiteRow key={site.id} site={site} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
