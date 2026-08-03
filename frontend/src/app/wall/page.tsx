"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Sun } from "lucide-react";

import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PowerFlowViewToggle } from "@/components/dashboard/power-flow-view-toggle";
import { StatusDot } from "@/components/status-badge";
import { BrandBadge } from "@/components/brand-badge";
import { RequireAuth } from "@/components/layout/require-auth";
import { useAlertStream } from "@/hooks/use-alert-stream";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useSites } from "@/hooks/use-sites";
import { formatPower, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 7;
const PAGE_INTERVAL_MS = 8_000;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function WallDisplay() {
  const { data: summary } = useFleetSummary();
  const { data: sites } = useSites();
  const now = useClock();
  const { mode, setMode } = usePowerFlowViewMode();
  useAlertStream(true);

  const problemSites = useMemo(() => (sites ?? []).filter((s) => s.status !== "online"), [sites]);
  const pageCount = Math.max(1, Math.ceil(problemSites.length / PAGE_SIZE));
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), PAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pageCount]);

  const visible = problemSites.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="dark min-h-screen bg-background px-6 py-5 text-foreground">
      <header className="mb-5 flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-sm bg-solar/15 text-solar">
            <Sun className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              SOLAR FLEET <span className="text-muted-foreground">OPS</span>
            </h1>
            <p className="label-caps text-tiny text-muted-foreground">Live fleet overview — auto-refreshing</p>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl leading-none font-semibold tabular-nums">
            {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="label-caps mt-1 text-tiny text-muted-foreground">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {summary && (
        <div className="mb-5">
          <KpiRow summary={summary} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-px border border-border bg-border xl:grid-cols-5">
        <div className="bg-card xl:col-span-3">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="label-caps text-xs font-semibold text-muted-foreground">Fleet Power Flow</h2>
            <PowerFlowViewToggle mode={mode} onChange={setMode} />
          </div>
          <div className="p-5">{summary && <FleetPowerFlowView summary={summary} mode={mode} />}</div>
        </div>

        <div className="bg-card xl:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="label-caps text-xs font-semibold text-muted-foreground">Needs Attention</h2>
            {problemSites.length > 0 && (
              <span className="rounded-sm bg-status-critical/15 px-2 py-0.5 font-mono text-sm font-bold text-status-critical">
                {problemSites.length}
              </span>
            )}
          </div>

          {problemSites.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <CheckCircle2 className="size-9 text-status-online" />
              <p className="text-sm">Every site is online</p>
            </div>
          ) : (
            <div>
              {visible.map((site) => (
                <div key={site.id} className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5 last:border-b-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StatusDot status={site.status} pulse={site.status === "error"} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{site.name}</span>
                        <BrandBadge brand={site.brand} />
                      </div>
                      <span
                        className={cn(
                          "label-caps text-micro font-semibold",
                          site.status === "error" ? "text-status-critical" : "text-status-warning",
                        )}
                      >
                        {STATUS_LABEL[site.status]}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
                    {formatPower(site.power_w)}
                  </div>
                </div>
              ))}
              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-1.5 py-3">
                  {Array.from({ length: pageCount }).map((_, i) => (
                    <span
                      key={i}
                      className={cn("h-1 w-4 rounded-full transition-colors", i === page ? "bg-foreground" : "bg-muted-foreground/25")}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {summary && summary.data_age_seconds > 900 && (
        <div className="mt-5 flex items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          <AlertTriangle className="size-4 shrink-0" />
          Data may be stale — last collection over {Math.round(summary.data_age_seconds / 60)} minutes ago.
        </div>
      )}
    </div>
  );
}

export default function WallPage() {
  return (
    <RequireAuth>
      <WallDisplay />
    </RequireAuth>
  );
}
