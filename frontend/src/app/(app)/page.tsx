"use client";

import { AlertTriangle } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { IssuesPanel } from "@/components/dashboard/issues-panel";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PowerFlowViewToggle } from "@/components/dashboard/power-flow-view-toggle";
import { SiteGrid } from "@/components/dashboard/site-grid";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useFleetSummary } from "@/hooks/use-fleet-summary";

export default function DashboardPage() {
  const { data: summary, isLoading, isError } = useFleetSummary();
  const { mode, setMode } = usePowerFlowViewMode();

  return (
    <div className="space-y-5">
      {isLoading ? (
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-[74px] w-full rounded-none" />
          ))}
        </div>
      ) : isError || !summary ? (
        <div className="flex items-center gap-2 border border-status-critical/30 bg-status-critical/5 px-4 py-3 text-sm text-status-critical">
          <AlertTriangle className="size-4 shrink-0" />
          Couldn&apos;t load fleet summary. Is the backend running?
        </div>
      ) : (
        <KpiRow summary={summary} />
      )}

      <div className="grid grid-cols-1 gap-px border border-border bg-border lg:grid-cols-3">
        <div className="flex flex-col bg-card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="label-caps text-xs font-semibold text-muted-foreground">Fleet Power Flow</h2>
            <PowerFlowViewToggle mode={mode} onChange={setMode} />
          </div>
          <div className="flex-1 p-4">
            {summary ? (
              <FleetPowerFlowView summary={summary} mode={mode} />
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">Loading…</div>
            )}
          </div>
        </div>

        <IssuesPanel />
      </div>

      <SiteGrid />
    </div>
  );
}
