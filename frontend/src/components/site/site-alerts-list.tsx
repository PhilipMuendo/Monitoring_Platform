"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSiteAlerts } from "@/hooks/use-alerts";
import { formatRelativeTime } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = {
  offline: "Offline",
  fault: "Fault",
  production_drop: "Production drop",
  battery_issue: "Battery",
};

/**
 * Alert history for one site, showing only what is CURRENTLY wrong by default.
 *
 * This page used to render every alert the endpoint returned, up to 50, with
 * resolved and active mixed together in one flat list. On a chronically
 * underperforming site that was a wall of near-identical rows — one site had
 * 14 production-drop entries, five of them from a single morning — and the one
 * or two rows that still mattered were buried in it.
 *
 * The duplicates themselves were an engine bug (no hysteresis, and the rule
 * resolved itself every night only to re-fire at dawn) and are fixed at source
 * in alertengine. This split is the second half: history is worth keeping, it
 * is just not what someone opening a site page is asking about. Resolved
 * alerts stay one click away rather than being deleted or hidden outright,
 * because a site that keeps recovering and re-failing is itself a signal.
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
        <CardTitle>
          Alerts
          {active.length > 0 && (
            <span className="ml-2 text-sm font-normal text-status-critical">{active.length} active</span>
          )}
        </CardTitle>
        {resolved.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          // Distinguishes "nothing wrong now" from "nothing ever happened" —
          // on a site with history, the first is the useful statement.
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 text-status-online" />
            <p>
              {resolved.length > 0
                ? "No active alerts. This site's earlier alerts have all resolved."
                : "No alerts recorded for this site."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((alert) => (
                <TableRow key={alert.id} className={alert.resolved_at ? "opacity-60" : undefined}>
                  <TableCell>
                    <Badge variant={alert.severity === "critical" && !alert.resolved_at ? "destructive" : "outline"}>
                      {TYPE_LABEL[alert.type] ?? alert.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{alert.message}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelativeTime(alert.created_at)}</TableCell>
                  <TableCell className="text-xs">
                    {alert.resolved_at ? (
                      <span className="text-muted-foreground">
                        {alert.acknowledged ? "Acknowledged" : "Resolved"}
                      </span>
                    ) : (
                      <span className="font-medium text-status-critical">Active</span>
                    )}
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
