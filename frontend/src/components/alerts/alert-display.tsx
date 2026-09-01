"use client";

import { AlertOctagon, AlertTriangle, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Alert, AlertType } from "@/lib/types";

// One definition of how an alert type is named and iconed, shared by the
// dashboard's Issues panel, the fleet-wide history page and the per-site
// list. These three had drifted apart as verbatim copies; a new AlertType
// added to lib/types.ts now surfaces here and nowhere else.
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

export function alertTypeLabel(type: AlertType | string): string {
  return TYPE_LABEL[type as AlertType] ?? type;
}

/**
 * The icon for an alert type, as a component rather than a factory that
 * returns one.
 *
 * Callers previously did `const Icon = alertTypeIcon(t)` and rendered
 * `<Icon />`, which React's static-components rule rejects: a component value
 * produced during render is a new type on every pass, so React remounts it and
 * resets any state it holds. Doing the lookup INSIDE a component keeps the
 * element type stable.
 */
export function AlertTypeIcon({
  type,
  className,
}: {
  type: AlertType | string;
  className?: string;
}) {
  const Icon = TYPE_ICON[type as AlertType] ?? AlertTriangle;
  return <Icon className={className} aria-hidden="true" />;
}

/** True when the alert is still open and rated critical. */
export function isActiveCritical(alert: Pick<Alert, "severity" | "resolved_at">): boolean {
  return alert.severity === "critical" && !alert.resolved_at;
}

export function AlertTypeBadge({
  alert,
  showIcon = true,
}: {
  alert: Pick<Alert, "type" | "severity" | "resolved_at">;
  showIcon?: boolean;
}) {
  return (
    <Badge variant={isActiveCritical(alert) ? "destructive" : "outline"} className={showIcon ? "gap-1" : undefined}>
      {showIcon && <AlertTypeIcon type={alert.type} className="size-3" />}
      {alertTypeLabel(alert.type)}
    </Badge>
  );
}

export function AlertStatus({ alert }: { alert: Pick<Alert, "resolved_at" | "acknowledged"> }) {
  return alert.resolved_at ? (
    <span className="text-muted-foreground">{alert.acknowledged ? "Acknowledged" : "Resolved"}</span>
  ) : (
    <span className="font-medium text-status-critical">Active</span>
  );
}
