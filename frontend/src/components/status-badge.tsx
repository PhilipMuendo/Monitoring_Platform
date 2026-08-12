import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/format";
import type { SiteStatus } from "@/lib/types";

// "unknown" and "commissioning" share the muted offline colour rather than
// a warning colour: neither is a fault, and colouring them like one would
// reintroduce exactly the false-alarm impression the status split exists to
// remove. They are distinguished by their label, not by alarm colour.
const DOT_CLASS: Record<SiteStatus, string> = {
  online: "bg-status-online",
  warning: "bg-status-warning",
  error: "bg-status-critical",
  offline: "bg-status-offline",
  unknown: "bg-status-offline",
  commissioning: "bg-status-offline",
};

const TEXT_CLASS: Record<SiteStatus, string> = {
  online: "text-status-online",
  warning: "text-status-warning",
  error: "text-status-critical",
  offline: "text-status-offline",
  unknown: "text-status-offline",
  commissioning: "text-status-offline",
};

/** Statuses that carry no live telemetry, so the pulse animation is off. */
const INERT: ReadonlySet<SiteStatus> = new Set<SiteStatus>(["offline", "unknown", "commissioning"]);

export function StatusDot({ status, pulse = false }: { status: SiteStatus; pulse?: boolean }) {
  return (
    <span className="relative flex size-2.5">
      {pulse && !INERT.has(status) && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", DOT_CLASS[status])} />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", DOT_CLASS[status])} />
    </span>
  );
}

export function StatusBadge({ status, className }: { status: SiteStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TEXT_CLASS[status], className)}>
      <StatusDot status={status} pulse={status === "error" || status === "warning"} />
      {STATUS_LABEL[status]}
    </span>
  );
}
