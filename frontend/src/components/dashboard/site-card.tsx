import { memo } from "react";
import Link from "next/link";
import { BatteryCharging } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BrandBadge } from "@/components/brand-badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCapacity, formatPower, formatRelativeTime } from "@/lib/format";
import { socIndicatorClass } from "@/lib/soc-color";
import { cn } from "@/lib/utils";
import type { SiteWithStatus } from "@/lib/types";

// A faulted or offline site has to be findable in a wall of 50 cards without
// reading any text, so status drives a left accent bar and a faint tint —
// not just the small status dot, which disappears at a glance.
//
// Exported because the wall display's site grid needs exactly this treatment
// at a larger size. Shared rather than restated so status never means one
// colour on the dashboard and another on the wall.
export const SITE_STATUS_ACCENT: Record<SiteWithStatus["status"], string> = {
  online: "border-l-transparent",
  warning: "border-l-status-warning bg-status-warning/[0.04]",
  error: "border-l-status-critical bg-status-critical/[0.06]",
  offline: "border-l-status-offline bg-muted/40",
  // Muted, not alarming. "We couldn't reach the vendor" and "not yet
  // commissioned" are both absence of information rather than faults, and
  // tinting them like a problem is what the status split exists to avoid.
  unknown: "border-l-status-offline bg-muted/20",
  commissioning: "border-l-status-offline bg-muted/20",
};

/**
 * Memoized because this renders once per site in a grid that re-renders on
 * every keystroke in the search box and on every 30s poll.
 *
 * useSites returns a new array identity each poll, but the SITE OBJECTS inside
 * it are structurally new too, so a default shallow compare would still
 * re-render all of them. The comparator below comes down to the fields this
 * card actually paints — a site whose telemetry has not moved does not
 * re-render at all, and typing in the search box only re-renders the cards
 * entering or leaving the filter rather than all of them.
 */
export const SiteCard = memo(SiteCardImpl, (prev, next) => {
  const a = prev.site;
  const b = next.site;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.name === b.name &&
    a.location === b.location &&
    a.brand === b.brand &&
    a.capacity_kw === b.capacity_kw &&
    a.power_w === b.power_w &&
    a.soc === b.soc &&
    a.last_seen_at === b.last_seen_at
  );
});

function SiteCardImpl({ site }: { site: SiteWithStatus }) {
  return (
    <Link href={`/sites/${site.id}`} className="group block">
      <Card
        className={cn(
          "gap-2 border-l-[3px] py-4 transition-all duration-200",
          "group-hover:-translate-y-0.5 group-hover:border-border/80 group-hover:shadow-md",
          SITE_STATUS_ACCENT[site.status],
        )}
      >
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
              <Progress value={site.soc} className="h-1.5" indicatorClassName={socIndicatorClass(site.soc)} />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(site.soc)}%
              </span>
            </div>
          )}

          <p className="mt-2 text-[10px] text-muted-foreground">
            {formatCapacity(site.capacity_kw)} · last seen {formatRelativeTime(site.last_seen_at)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
