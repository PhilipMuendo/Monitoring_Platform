"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Sun } from "lucide-react";

import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PowerFlowViewToggle } from "@/components/dashboard/power-flow-view-toggle";
import { StatusBadge } from "@/components/status-badge";
import { BrandBadge } from "@/components/brand-badge";
import { RequireAuth } from "@/components/layout/require-auth";
import { useAlertStream } from "@/hooks/use-alert-stream";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useSites } from "@/hooks/use-sites";
import { formatPower } from "@/lib/format";

const PAGE_SIZE = 6;
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
    <div className="min-h-screen bg-background px-8 py-6 text-foreground">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sun className="size-8 text-solar" />
          <div>
            <h1 className="text-2xl font-bold">Solar Fleet Monitor</h1>
            <p className="text-sm text-muted-foreground">Live fleet overview</p>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-semibold tabular-nums">
            {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-sm text-muted-foreground">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {summary && (
        <div className="mb-6">
          <KpiRow summary={summary} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="rounded-xl border bg-card p-6 xl:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Fleet Power Flow</h2>
            <PowerFlowViewToggle mode={mode} onChange={setMode} />
          </div>
          {summary && <FleetPowerFlowView summary={summary} mode={mode} />}
        </div>

        <div className="rounded-xl border bg-card p-6 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Needs Attention</h2>
            {problemSites.length > 0 && (
              <span className="rounded-full bg-status-critical/15 px-2.5 py-0.5 text-sm font-medium text-status-critical">
                {problemSites.length}
              </span>
            )}
          </div>

          {problemSites.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <CheckCircle2 className="size-10 text-status-online" />
              <p>Every site is online</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((site) => (
                <div key={site.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{site.name}</span>
                      <BrandBadge brand={site.brand} />
                    </div>
                    <StatusBadge status={site.status} className="mt-1" />
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                    {formatPower(site.power_w)}
                  </div>
                </div>
              ))}
              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-2">
                  {Array.from({ length: pageCount }).map((_, i) => (
                    <span
                      key={i}
                      className={`size-1.5 rounded-full ${i === page ? "bg-foreground" : "bg-muted-foreground/30"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {summary && summary.data_age_seconds > 900 && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-status-warning">
          <AlertTriangle className="size-4" />
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
