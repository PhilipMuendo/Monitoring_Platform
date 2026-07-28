import Link from "next/link";
import { BatteryCharging } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BrandBadge } from "@/components/brand-badge";
import { StatusBadge } from "@/components/status-badge";
import { formatPower, formatRelativeTime } from "@/lib/format";
import type { SiteWithStatus } from "@/lib/types";

export function SiteCard({ site }: { site: SiteWithStatus }) {
  return (
    <Link href={`/sites/${site.id}`}>
      <Card className="gap-2 py-4 transition-colors hover:bg-accent/50">
        <CardContent className="px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{site.name}</p>
              <p className="truncate text-xs text-muted-foreground">{site.location}</p>
            </div>
            <BrandBadge brand={site.brand} />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <StatusBadge status={site.status} />
            <span className="font-mono text-sm font-semibold tabular-nums">{formatPower(site.power_w)}</span>
          </div>

          {site.soc != null && (
            <div className="mt-2 flex items-center gap-2">
              <BatteryCharging className="size-3.5 shrink-0 text-battery" />
              <Progress value={site.soc} className="h-1.5" />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(site.soc)}%
              </span>
            </div>
          )}

          <p className="mt-2 text-[10px] text-muted-foreground">
            {site.capacity_kw.toFixed(1)} kW · last seen {formatRelativeTime(site.last_seen_at)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
