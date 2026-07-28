"use client";

import dynamic from "next/dynamic";
import { memo } from "react";

import { FleetPowerFlow } from "@/components/dashboard/fleet-power-flow";
import { Skeleton } from "@/components/ui/skeleton";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import type { FleetSummary } from "@/lib/types";

// The only place three.js/@react-three/fiber/@react-three/drei get
// imported: dynamic(..., { ssr: false }) keeps the whole WebGL scene out
// of the server render pass and out of the server bundle entirely, not
// just unrendered on first paint. Must be called from a Client Component.
const Fleet3DPowerFlow = dynamic(
  () => import("@/components/dashboard/fleet-3d-power-flow").then((m) => m.Fleet3DPowerFlow),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full sm:h-[340px]" />,
  },
);

interface FleetPowerFlowViewProps {
  summary: FleetSummary;
  mode: PowerFlowViewMode;
}

export const FleetPowerFlowView = memo(function FleetPowerFlowView({ summary, mode }: FleetPowerFlowViewProps) {
  return mode === "3d" ? <Fleet3DPowerFlow summary={summary} /> : <FleetPowerFlow summary={summary} />;
});
