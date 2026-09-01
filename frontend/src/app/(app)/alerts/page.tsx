"use client";

import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertStatus, AlertTypeBadge } from "@/components/alerts/alert-display";
import { BrandBadge } from "@/components/brand-badge";
import { SkeletonList } from "@/components/skeleton-list";
import { useAlertHistory } from "@/hooks/use-alerts";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNumericQueryParam } from "@/hooks/use-query-param";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Alert } from "@/lib/types";

const PAGE_SIZE = 50;

// Tailwind's `sm`. Used as a mount gate rather than a `hidden sm:table`
// class pair: the two layouts render the SAME 50 rows, and CSS-hiding one
// keeps both mounted, so every row built its DOM twice and re-rendered twice
// on every poll. serverValue=false so the hydrating render matches the
// mobile branch and the card list is what appears first on a phone.
const TABLE_QUERY = "(min-width: 640px)";

function AlertCardList({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <Link
            href={`/sites/${alert.site_id}`}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              alert.resolved_at ? "opacity-60" : undefined,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate font-medium">{alert.site_name ?? "Unknown site"}</span>
                {alert.brand && <BrandBadge brand={alert.brand} />}
              </div>
              <AlertTypeBadge alert={alert} />
            </div>
            <p className="text-sm text-muted-foreground">{alert.message}</p>
            <div className="flex items-center justify-between text-xs">
              <time dateTime={alert.created_at} className="font-mono text-muted-foreground">
                {formatDateTime(alert.created_at)}
              </time>
              <AlertStatus alert={alert} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AlertTable({ alerts, total }: { alerts: Alert[]; total: number }) {
  return (
    <Table>
      <TableCaption className="sr-only">
        Fleet alert history, newest first. {total} alerts in total.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Site</TableHead>
          <TableHead scope="col">Type</TableHead>
          <TableHead scope="col">Message</TableHead>
          <TableHead scope="col">Raised</TableHead>
          <TableHead scope="col">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((alert) => (
          <TableRow key={alert.id} className={alert.resolved_at ? "opacity-60" : undefined}>
            <TableCell>
              <Link
                href={`/sites/${alert.site_id}`}
                className="flex items-center gap-1.5 font-medium hover:underline"
              >
                {alert.site_name ?? "Unknown site"}
                {alert.brand && <BrandBadge brand={alert.brand} />}
              </Link>
            </TableCell>
            <TableCell>
              <AlertTypeBadge alert={alert} />
            </TableCell>
            <TableCell className="max-w-sm truncate text-sm text-muted-foreground">{alert.message}</TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              <time dateTime={alert.created_at}>{formatDateTime(alert.created_at)}</time>
            </TableCell>
            <TableCell className="text-xs">
              <AlertStatus alert={alert} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The standalone alert history page: every alert fleet-wide, active or
 * resolved, newest first, with the absolute date and time it was raised.
 *
 * Distinct from the dashboard's Issues panel, which is a glanceable widget
 * (active only, relative timestamps, no paging). This is the record — what a
 * "when did this actually start" conversation needs.
 *
 * Two layouts, one mounted at a time: a real table from `sm` up, a stacked
 * card list below it. Every column matters here, so narrowing the table to
 * fit a phone would defeat the page's purpose; restructuring into a card per
 * alert keeps all five fields with no horizontal scroll.
 */
function AlertsHistory() {
  const [page, setPage] = useNumericQueryParam("page", 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { data, isLoading, isFetching } = useAlertHistory({ limit: PAGE_SIZE, offset });
  const showTable = useMediaQuery(TABLE_QUERY);

  const alerts = data?.alerts ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Alert History</h1>
        <p className="text-sm text-muted-foreground">Every alert raised across the fleet, newest first.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>
            All alerts
            {total > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">{total} total</span>}
          </CardTitle>
          {total > PAGE_SIZE && (
            <nav aria-label="Alert history pages" className="flex items-center gap-2 text-sm text-muted-foreground">
              {/* aria-live so a screen reader hears the range change; the
                  chevrons alone gave no feedback that anything happened. */}
              <span aria-live="polite">
                {from}-{to} of {total}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={page >= lastPage || isFetching}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonList count={6} className="h-10" label="Loading alert history" />
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="size-8 text-status-online" aria-hidden="true" />
              <p>{page > 1 ? "No alerts on this page." : "No alerts have been raised yet."}</p>
            </div>
          ) : showTable ? (
            <AlertTable alerts={alerts} total={total} />
          ) : (
            <AlertCardList alerts={alerts} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AlertsHistoryPage() {
  // useSearchParams needs a Suspense boundary above it so the rest of the
  // route can prerender without waiting on the client-only URL read.
  return (
    <Suspense fallback={<SkeletonList count={6} className="h-10" label="Loading alert history" />}>
      <AlertsHistory />
    </Suspense>
  );
}
