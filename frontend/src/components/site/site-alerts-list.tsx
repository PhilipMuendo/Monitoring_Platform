"use client";

import { Badge } from "@/components/ui/badge";
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

export function SiteAlertsList({ siteId }: { siteId: string }) {
  const { data: alerts, isLoading } = useSiteAlerts(siteId);

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="label-caps text-xs font-semibold text-muted-foreground">Alert History</h2>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !alerts?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No alerts recorded for this site.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="label-caps text-[10px]">Type</TableHead>
                <TableHead className="label-caps text-[10px]">Message</TableHead>
                <TableHead className="label-caps hidden text-[10px] sm:table-cell">Raised</TableHead>
                <TableHead className="label-caps text-[10px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <Badge variant={alert.severity === "critical" ? "destructive" : "outline"} className="rounded-sm">
                      {TYPE_LABEL[alert.type] ?? alert.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-sm sm:max-w-xs">{alert.message}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                    {formatRelativeTime(alert.created_at)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {alert.resolved_at ? (
                      <span className="text-muted-foreground">
                        {alert.acknowledged ? "Acknowledged" : "Resolved"}
                      </span>
                    ) : (
                      <span className="label-caps font-semibold text-status-critical">Active</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
