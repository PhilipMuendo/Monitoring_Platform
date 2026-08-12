"use client";

import { AlertTriangle } from "lucide-react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { IssuesPanel } from "@/components/dashboard/issues-panel";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PowerFlowSkeleton } from "@/components/dashboard/power-flow-skeleton";
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

      {/* 4-col grid, flow card taking 3, rather than 3-col taking 2: the
          company's feedback was that the 3D view reads too small. Widening
          the card's share (66% -> 75%) alongside the taller POWER_FLOW_BOX
          roughly doubles the scene's on-screen area without pushing the
          issues panel below the fold, which would demote live alerts. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Fleet Power Flow</CardTitle>
            <CardAction>
              <PowerFlowViewToggle mode={mode} onChange={setMode} />
            </CardAction>
          </CardHeader>
          <CardContent>
            {summary ? <FleetPowerFlowView summary={summary} mode={mode} /> : <PowerFlowSkeleton />}
          </CardContent>
        </Card>

        <IssuesPanel />
      </div>

      <SiteGrid />
    </div>
  );
}
