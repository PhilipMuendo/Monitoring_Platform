"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTypeIcon, alertTypeLabel } from "@/components/alerts/alert-display";
import { BrandBadge } from "@/components/brand-badge";
import { SkeletonList } from "@/components/skeleton-list";
import { useAcknowledgeAlert, useActiveAlerts } from "@/hooks/use-alerts";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { Alert } from "@/lib/types";

export function IssuesPanel() {
  const { data: alerts, isLoading } = useActiveAlerts();
  const acknowledge = useAcknowledgeAlert();
  const { hasRole } = useAuth();
  const canAcknowledge = hasRole("admin", "technician");

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        {/* A real <h2>, not a styled div: this panel is a landmark section of
            the dashboard and was previously unreachable by heading
            navigation. CardTitle renders a div, so the element is overridden
            here rather than wrapping one inside the other. */}
        <CardTitle asChild>
          <h2 className="flex items-center gap-2">
            Active Issues
            {!!alerts?.length && (
              <Badge variant="destructive" aria-label={`${alerts.length} active issues`}>
                {alerts.length}
              </Badge>
            )}
          </h2>
        </CardTitle>
        <Link href="/alerts" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          View all
          <span className="sr-only"> alerts</span>
        </Link>
      </CardHeader>
      <CardContent className="flex-1 px-0">
        {isLoading ? (
          <SkeletonList count={4} className="h-14" gap="space-y-3 px-6" label="Loading active issues" />
        ) : !alerts?.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
            <CheckCircle2 className="size-8 text-status-online" aria-hidden="true" />
            <p className="text-sm">All systems normal</p>
          </div>
        ) : (
          <ScrollArea className="h-[360px] px-6">
            <ul className="flex flex-col gap-2 pb-2">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <AlertRow
                    alert={alert}
                    canAcknowledge={canAcknowledge}
                    onAcknowledge={() =>
                      acknowledge.mutate(alert.id, {
                        onSuccess: () => toast.success("Alert acknowledged"),
                        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to acknowledge"),
                      })
                    }
                    acknowledging={acknowledge.isPending && acknowledge.variables === alert.id}
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One active alert.
 *
 * The row used to be a `<div role="button">` with a router.push handler and
 * an "Ack" <button> nested inside it. That is a control inside a control —
 * ambiguous to assistive tech, unreachable by keyboard in the inner case, and
 * it only handled Enter, not Space, so it did not even behave like the button
 * it claimed to be. It is now a real <Link> for navigation with the Ack
 * button as a SIBLING, which gets correct semantics, both keys, middle-click
 * and open-in-new-tab for free.
 */
function AlertRow({
  alert,
  canAcknowledge,
  onAcknowledge,
  acknowledging,
}: {
  alert: Alert;
  canAcknowledge: boolean;
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const isCritical = alert.severity === "critical";
  const siteName = alert.site_name ?? "Unknown site";

  return (
    <div className="relative flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent">
      <AlertTypeIcon
        type={alert.type}
        className={
          isCritical
            ? "mt-0.5 size-4 shrink-0 text-status-critical"
            : "mt-0.5 size-4 shrink-0 text-status-warning"
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Stretched link: the ::after covers the whole row so the entire
              card is clickable, while the accessible name stays just the site
              name. z-0 keeps it under the Ack button, which sits at z-10. */}
          <Link
            href={`/sites/${alert.site_id}`}
            className="text-sm font-medium after:absolute after:inset-0 after:z-0 after:content-[''] focus-visible:outline-none"
          >
            {siteName}
          </Link>
          {alert.brand && <BrandBadge brand={alert.brand} />}
          <Badge variant={isCritical ? "destructive" : "outline"} className="text-[10px]">
            {alertTypeLabel(alert.type)}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{alert.message}</p>
        {/* The visible label stays relative ("3m ago") because that is what a
            glance needs; dateTime carries the absolute instant for anything
            reading the DOM, and title surfaces it on hover. */}
        <time
          dateTime={alert.created_at}
          title={formatDateTime(alert.created_at)}
          className="mt-0.5 block text-[10px] text-muted-foreground"
        >
          {formatRelativeTime(alert.created_at)}
        </time>
      </div>
      {canAcknowledge && (
        <Button
          size="sm"
          variant="outline"
          disabled={acknowledging}
          aria-label={`Acknowledge ${alertTypeLabel(alert.type)} alert at ${siteName}`}
          className="relative z-10"
          onClick={onAcknowledge}
        >
          Ack
        </Button>
      )}
    </div>
  );
}
