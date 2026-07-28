"use client";

import { useRouter } from "next/navigation";
import { AlertOctagon, AlertTriangle, CheckCircle2, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandBadge } from "@/components/brand-badge";
import { useAcknowledgeAlert, useActiveAlerts } from "@/hooks/use-alerts";
import { useAuth } from "@/lib/auth-context";
import { formatRelativeTime } from "@/lib/format";
import type { Alert, AlertType } from "@/lib/types";

const TYPE_ICON: Record<AlertType, React.ComponentType<{ className?: string }>> = {
  offline: WifiOff,
  fault: AlertOctagon,
  production_drop: AlertTriangle,
  battery_issue: AlertTriangle,
};

const TYPE_LABEL: Record<AlertType, string> = {
  offline: "Offline",
  fault: "Fault",
  production_drop: "Production drop",
  battery_issue: "Battery",
};

export function IssuesPanel() {
  const { data: alerts, isLoading } = useActiveAlerts();
  const acknowledge = useAcknowledgeAlert();
  const { hasRole } = useAuth();
  const router = useRouter();
  const canAcknowledge = hasRole("admin", "technician");

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          Active Issues
          {!!alerts?.length && <Badge variant="destructive">{alerts.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 px-0">
        {isLoading ? (
          <div className="space-y-3 px-6">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !alerts?.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
            <CheckCircle2 className="size-8 text-status-online" />
            <p className="text-sm">All systems normal</p>
          </div>
        ) : (
          <ScrollArea className="h-[360px] px-6">
            <div className="flex flex-col gap-2 pb-2">
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  canAcknowledge={canAcknowledge}
                  onOpen={() => router.push(`/sites/${alert.site_id}`)}
                  onAcknowledge={() =>
                    acknowledge.mutate(alert.id, {
                      onSuccess: () => toast.success("Alert acknowledged"),
                      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to acknowledge"),
                    })
                  }
                  acknowledging={acknowledge.isPending && acknowledge.variables === alert.id}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRow({
  alert,
  canAcknowledge,
  onOpen,
  onAcknowledge,
  acknowledging,
}: {
  alert: Alert;
  canAcknowledge: boolean;
  onOpen: () => void;
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const Icon = TYPE_ICON[alert.type];
  const isCritical = alert.severity === "critical";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
    >
      <Icon className={isCritical ? "mt-0.5 size-4 shrink-0 text-status-critical" : "mt-0.5 size-4 shrink-0 text-status-warning"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{alert.site_name ?? "Unknown site"}</span>
          {alert.brand && <BrandBadge brand={alert.brand} />}
          <Badge variant={isCritical ? "destructive" : "outline"} className="text-[10px]">
            {TYPE_LABEL[alert.type]}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{alert.message}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{formatRelativeTime(alert.created_at)}</p>
      </div>
      {canAcknowledge && (
        <Button
          size="sm"
          variant="outline"
          disabled={acknowledging}
          onClick={(e) => {
            e.stopPropagation();
            onAcknowledge();
          }}
        >
          Ack
        </Button>
      )}
    </div>
  );
}
