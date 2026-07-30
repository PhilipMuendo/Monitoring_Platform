import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/format";
import type { SiteStatus } from "@/lib/types";

const DOT_CLASS: Record<SiteStatus, string> = {
  online: "bg-status-online",
  warning: "bg-status-warning",
  error: "bg-status-critical",
  offline: "bg-status-offline",
};

const TEXT_CLASS: Record<SiteStatus, string> = {
  online: "text-status-online",
  warning: "text-status-warning",
  error: "text-status-critical",
  offline: "text-status-offline",
};

export function StatusDot({ status, pulse = false }: { status: SiteStatus; pulse?: boolean }) {
  return (
    <span className="relative flex size-1.5 shrink-0">
      {pulse && status !== "offline" && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", DOT_CLASS[status])} />
      )}
      <span className={cn("relative inline-flex size-1.5 rounded-full", DOT_CLASS[status])} />
    </span>
  );
}

export function StatusBadge({ status, className }: { status: SiteStatus; className?: string }) {
  return (
    <span className={cn("label-caps inline-flex items-center gap-1.5 text-[11px] font-semibold", TEXT_CLASS[status], className)}>
      <StatusDot status={status} pulse={status === "error" || status === "warning"} />
      {STATUS_LABEL[status]}
    </span>
  );
}
