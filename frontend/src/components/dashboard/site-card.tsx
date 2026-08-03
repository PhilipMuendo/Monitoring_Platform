"use client";

import { useRouter } from "next/navigation";

import { Progress } from "@/components/ui/progress";
import { TableCell, TableRow } from "@/components/ui/table";
import { BrandBadge } from "@/components/brand-badge";
import { StatusDot, STATUS_DOT_CLASS } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { formatPower, formatRelativeTime, STATUS_LABEL } from "@/lib/format";
import type { SiteWithStatus } from "@/lib/types";

// A dense telemetry row, not a soft summary tile — this is the primary
// list surface for an operator scanning dozens-to-hundreds of sites, so
// every row favors information density (mono numerics, thin SOC bar,
// hairline dividers) over decorative padding. The hover state reveals a
// left accent bar in the row's own status color rather than a flat tint —
// depth through a considered detail instead of an undifferentiated highlight.
export function SiteRow({ site }: { site: SiteWithStatus }) {
  const router = useRouter();

  return (
    <TableRow
      className="group/row relative cursor-pointer"
      onClick={() => router.push(`/sites/${site.id}`)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/sites/${site.id}`)}
    >
      <TableCell className="w-8" title={STATUS_LABEL[site.status]}>
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-0.5 origin-left scale-y-0 transition-transform duration-150 ease-[var(--ease-out-confident)] group-hover/row:scale-y-100",
            STATUS_DOT_CLASS[site.status],
          )}
          aria-hidden
        />
        <StatusDot status={site.status} pulse={site.status === "error" || site.status === "warning"} />
      </TableCell>
      <TableCell>
        <div className="min-w-0">
          <p className="truncate font-medium">{site.name}</p>
          <p className="truncate text-xs text-muted-foreground">{site.location}</p>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <BrandBadge brand={site.brand} />
      </TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">{formatPower(site.power_w)}</TableCell>
      <TableCell className="hidden w-36 md:table-cell">
        {site.soc != null ? (
          <div className="flex items-center gap-2">
            <Progress value={site.soc} className="h-1 [&>div]:bg-battery" />
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(site.soc)}%
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground lg:table-cell">
        {site.capacity_kw.toFixed(1)} kW
      </TableCell>
      <TableCell className="hidden text-right text-xs text-muted-foreground lg:table-cell">
        {formatRelativeTime(site.last_seen_at)}
      </TableCell>
    </TableRow>
  );
}
