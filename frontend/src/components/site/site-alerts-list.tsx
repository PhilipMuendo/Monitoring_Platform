"use client";

import { Badge } from "@/components/ui/badge";
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

export function SiteAlertsList({ siteId }: { siteId: string }) {
  const { data: alerts, isLoading } = useSiteAlerts(siteId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert History</CardTitle>
      </CardHeader>
      <CardContent>
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
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>
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
