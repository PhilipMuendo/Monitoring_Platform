"use client";

import { AlertTriangle } from "lucide-react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-6">
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError || !summary ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <AlertTriangle className="size-4" />
            Couldn&apos;t load fleet summary. Is the backend running?
          </CardContent>
        </Card>
      ) : (
        <KpiRow summary={summary} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Fleet Power Flow</CardTitle>
            <CardAction>
              <PowerFlowViewToggle mode={mode} onChange={setMode} />
            </CardAction>
          </CardHeader>
          <CardContent>
            {summary ? (
              <FleetPowerFlowView summary={summary} mode={mode} />
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">Loading…</div>
            )}
          </CardContent>
        </Card>

        <IssuesPanel />
      </div>

      <SiteGrid />
    </div>
  );
}
