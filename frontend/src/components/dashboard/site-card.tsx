"use client";

import { useRouter } from "next/navigation";

import { Progress } from "@/components/ui/progress";
import { TableCell, TableRow } from "@/components/ui/table";
import { BrandBadge } from "@/components/brand-badge";
import { StatusDot } from "@/components/status-badge";
import { formatPower, formatRelativeTime, STATUS_LABEL } from "@/lib/format";
import type { SiteWithStatus } from "@/lib/types";

// A dense telemetry row, not a soft summary tile — this is the primary
// list surface for an operator scanning dozens-to-hundreds of sites, so
// every row favors information density (mono numerics, thin SOC bar,
// hairline dividers) over decorative padding.
export function SiteRow({ site }: { site: SiteWithStatus }) {
  const router = useRouter();

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => router.push(`/sites/${site.id}`)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/sites/${site.id}`)}
    >
      <TableCell className="w-8" title={STATUS_LABEL[site.status]}>
        <StatusDot status={site.status} pulse={site.status === "error" || site.status === "warning"} />
      </TableCell>
      <TableCell>
        <div className="min-w-0">
          <p className="truncate font-medium">{site.name}</p>
          <p className="truncate text-xs text-muted-foreground">{site.location}</p>
        </div>
      </TableCell>
      <TableCell>
        <BrandBadge brand={site.brand} />
      </TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">{formatPower(site.power_w)}</TableCell>
      <TableCell className="w-36">
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
      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {site.capacity_kw.toFixed(1)} kW
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">{formatRelativeTime(site.last_seen_at)}</TableCell>
    </TableRow>
  );
}
