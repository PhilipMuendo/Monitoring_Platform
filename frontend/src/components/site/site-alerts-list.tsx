"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertStatus, AlertTypeBadge } from "@/components/alerts/alert-display";
import { SkeletonList } from "@/components/skeleton-list";
import { useSiteAlerts } from "@/hooks/use-alerts";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

/**
 * Alert history for one site, showing only what is CURRENTLY wrong by default.
 *
 * Resolved alerts stay one click away rather than hidden outright: a site that
 * keeps recovering and re-failing is itself a signal. Mixing them into the
 * default list buries the one or two rows that still matter.
 */
export function SiteAlertsList({ siteId }: { siteId: string }) {
  const { data: alerts, isLoading } = useSiteAlerts(siteId);
  const [showResolved, setShowResolved] = useState(false);

  const { active, resolved } = useMemo(() => {
    const list = alerts ?? [];
    return {
      active: list.filter((a) => !a.resolved_at),
      resolved: list.filter((a) => a.resolved_at),
    };
  }, [alerts]);

  const visible = showResolved ? [...active, ...resolved] : active;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle asChild>
          <h2>
            Alerts
            {active.length > 0 && (
              <span className="ml-2 text-sm font-normal text-status-critical">{active.length} active</span>
            )}
          </h2>
        </CardTitle>
        {resolved.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showResolved}
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonList count={3} className="h-9" label="Loading alerts for this site" />
        ) : visible.length === 0 ? (
          // Distinguishes "nothing wrong now" from "nothing ever happened" —
          // on a site with history, the first is the useful statement.
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 text-status-online" aria-hidden="true" />
            <p>
              {resolved.length > 0
                ? "No active alerts. This site's earlier alerts have all resolved."
                : "No alerts recorded for this site."}
            </p>
          </div>
        ) : (
          <Table>
            <TableCaption className="sr-only">
              {showResolved ? "Active and resolved alerts" : "Active alerts"} for this site.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col">Message</TableHead>
                <TableHead scope="col">Raised</TableHead>
                <TableHead scope="col">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((alert) => (
                <TableRow key={alert.id} className={alert.resolved_at ? "opacity-60" : undefined}>
                  <TableCell>
                    <AlertTypeBadge alert={alert} showIcon={false} />
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{alert.message}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <time dateTime={alert.created_at} title={formatDateTime(alert.created_at)}>
                      {formatRelativeTime(alert.created_at)}
                    </time>
                  </TableCell>
                  <TableCell className="text-xs">
                    <AlertStatus alert={alert} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
