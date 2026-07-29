"use client";

import dynamic from "next/dynamic";
import { memo } from "react";

import { FleetPowerFlow } from "@/components/dashboard/fleet-power-flow";
import { PowerFlowSkeleton } from "@/components/dashboard/power-flow-skeleton";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import type { FleetSummary } from "@/lib/types";

/**
 * Height of the flow panel. Shared by the 2D view, the 3D canvas and the
 * loading skeleton so switching modes (or finishing a load) never resizes
 * the panel and reflows the page beneath it.
 */
export const POWER_FLOW_BOX = "h-[320px] sm:h-[380px]";

// The only place three.js/@react-three/fiber/@react-three/drei get
// imported: dynamic(..., { ssr: false }) keeps the whole WebGL scene out
// of the server render pass and out of the server bundle entirely, not
// just unrendered on first paint. Must be called from a Client Component.
const Fleet3DPowerFlow = dynamic(
  () => import("@/components/dashboard/fleet-3d-power-flow").then((m) => m.Fleet3DPowerFlow),
  {
    ssr: false,
    loading: () => <PowerFlowSkeleton />,
  },
);

interface FleetPowerFlowViewProps {
  summary: FleetSummary;
  mode: PowerFlowViewMode;
  /** Overrides the default panel height — the wall display fits it to the screen. */
  className?: string;
}

export const FleetPowerFlowView = memo(function FleetPowerFlowView({
  summary,
  mode,
  className = POWER_FLOW_BOX,
}: FleetPowerFlowViewProps) {
  return mode === "3d" ? (
    <Fleet3DPowerFlow summary={summary} className={className} />
  ) : (
    <FleetPowerFlow summary={summary} className={className} />
  );
});
