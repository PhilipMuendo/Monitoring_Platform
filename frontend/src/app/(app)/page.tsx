"use client";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/error-state";
import { SkeletonList } from "@/components/skeleton-list";
import { FleetPowerFlowView } from "@/components/dashboard/fleet-power-flow-view";
import { IssuesPanel } from "@/components/dashboard/issues-panel";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PowerFlowSkeleton } from "@/components/dashboard/power-flow-skeleton";
import { PowerFlowViewToggle } from "@/components/dashboard/power-flow-view-toggle";
import { SiteGrid } from "@/components/dashboard/site-grid";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useFleetSummary } from "@/hooks/use-fleet-summary";

export default function DashboardPage() {
  const { data: summary, isLoading, isError, refetch } = useFleetSummary();
  const { mode, setMode } = usePowerFlowViewMode();

  return (
    <div className="space-y-6">
      {/* The dashboard had no <h1> at all, which left the page unnamed to a
          screen reader and broke heading navigation for the whole app. It is
          visually hidden because the header wordmark already says where you
          are; the document still needs the heading. */}
      <h1 className="sr-only">Fleet dashboard</h1>

      {isLoading ? (
        <SkeletonList
          count={6}
          className="h-20"
          gap="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          label="Loading fleet summary"
        />
      ) : isError || !summary ? (
        <Card>
          <CardContent className="py-6">
            <ErrorState
              compact
              title="Couldn't load fleet summary"
              description="The backend didn't respond. Check that it's running and reachable, then try again."
              onRetry={() => refetch()}
            />
          </CardContent>
        </Card>
      ) : (
        <KpiRow summary={summary} />
      )}

      {/* 4-col grid, flow card taking 3, rather than 3-col taking 2: the 3D
          view read too small at 66%. Widening its share to 75% alongside the
          taller POWER_FLOW_BOX roughly doubles the scene's on-screen area
          without pushing the issues panel below the fold, which would demote
          live alerts. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle asChild>
              <h2>Fleet Power Flow</h2>
            </CardTitle>
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
