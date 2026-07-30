"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandBadge } from "@/components/brand-badge";
import { useAcknowledgeAlert, useActiveAlerts } from "@/hooks/use-alerts";
import { useAuth } from "@/lib/auth-context";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Alert, AlertType } from "@/lib/types";

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
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="label-caps text-xs font-semibold text-muted-foreground">Active Issues</h2>
        {!!alerts?.length && (
          <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-status-critical/15 px-1 font-mono text-[10px] font-bold text-status-critical">
            {alerts.length}
          </span>
        )}
      </div>
      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !alerts?.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
            <CheckCircle2 className="size-7 text-status-online" />
            <p className="text-xs">All systems normal</p>
          </div>
        ) : (
          <ScrollArea className="h-[360px]">
            <div className="flex flex-col">
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
      </div>
    </div>
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
  const isCritical = alert.severity === "critical";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="flex cursor-pointer items-start gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-accent"
    >
      <span
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", isCritical ? "bg-status-critical" : "bg-status-warning")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{alert.site_name ?? "Unknown site"}</span>
          {alert.brand && <BrandBadge brand={alert.brand} />}
          <span
            className={cn(
              "label-caps text-[9px] font-semibold",
              isCritical ? "text-status-critical" : "text-muted-foreground",
            )}
          >
            {TYPE_LABEL[alert.type]}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{alert.message}</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{formatRelativeTime(alert.created_at)}</p>
      </div>
      {canAcknowledge && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
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
