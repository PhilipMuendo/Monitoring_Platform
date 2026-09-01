"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrandBadge } from "@/components/brand-badge";
import { StatusBadge } from "@/components/status-badge";
import { CreateSiteDialog } from "@/components/admin/create-site-dialog";
import { EditSiteDialog } from "@/components/admin/edit-site-dialog";
import { formatCapacity } from "@/lib/format";
import { useDeleteSite } from "@/hooks/use-admin";
import { useSites } from "@/hooks/use-sites";
import { ApiError } from "@/lib/api-client";
import type { SiteWithStatus } from "@/lib/types";

function SiteRowActions({ site }: { site: SiteWithStatus }) {
  const deleteSite = useDeleteSite();

  return (
    <>
      <EditSiteDialog site={site} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost">
            <Trash2 className="size-4 text-status-critical" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {site.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the site and all of its historical metrics and alerts. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteSite.mutate(site.id, {
                  onSuccess: () => toast.success("Site deleted"),
                  onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete site"),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Renders two ways from the same data, like the /alerts history table: a
 * real <table> from `sm` up, and a stacked card list below it. Six columns
 * (name, brand, status, capacity, active, actions) don't fit a phone
 * screen without forcing horizontal scroll to reach the edit/delete
 * buttons — restructuring the same fields into a card per site keeps
 * every action reachable with a straight vertical scroll instead.
 */
export function SitesAdminTable() {
  const { data: sites, isLoading } = useSites({ all: true });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sites</h2>
        <CreateSiteDialog />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* Card list — below sm only. */}
          <div className="flex flex-col gap-2 sm:hidden">
            {sites?.map((site) => (
              <div
                key={site.id}
                className={site.is_active ? "rounded-lg border p-3" : "rounded-lg border p-3 opacity-50"}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{site.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <BrandBadge brand={site.brand} />
                      <StatusBadge status={site.status} />
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <SiteRowActions site={site} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatCapacity(site.capacity_kw)}</span>
                  <span>{site.is_active ? "Active" : "Inactive"}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Table — sm and up. */}
          <Table className="hidden sm:table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites?.map((site) => (
                <TableRow key={site.id} className={site.is_active ? undefined : "opacity-50"}>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell>
                    <BrandBadge brand={site.brand} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={site.status} />
                  </TableCell>
                  <TableCell>{formatCapacity(site.capacity_kw)}</TableCell>
                  <TableCell>{site.is_active ? "Yes" : "No"}</TableCell>
                  <TableCell className="flex justify-end gap-1 text-right">
                    <SiteRowActions site={site} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
