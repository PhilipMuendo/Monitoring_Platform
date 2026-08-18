"use client";

import { FleetPowerFlow } from "@/components/dashboard/fleet-power-flow";
import { POWER_FLOW_BOX, PowerFlowView } from "@/components/dashboard/power-flow-view";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { fleetPowerFlowScene } from "@/lib/power-flow-model";
import type { FleetSummary } from "@/lib/types";

export { POWER_FLOW_BOX };

/**
 * The fleet's power flow, 2D or 3D.
 *
 * All of the machinery — the lazy WebGL chunk, the WebGL tier gate, the
 * narrow-screen gate, the 2D-holds-the-panel-while-it-loads behaviour — moved
 * to PowerFlowView, which is subject-agnostic. What is left here is the two
 * things that are actually fleet-specific: which numbers to draw, and which 2D
 * diagram to fall back to.
 *
 * That split is what let the same renderer go onto every site page without a
 * fork (see site-power-flow-view.tsx). A fork is how two views of the same
 * telemetry start disagreeing about which way the grid arrow points.
 */
export function FleetPowerFlowView({
  summary,
  mode,
  className,
}: {
  summary: FleetSummary;
  mode: PowerFlowViewMode;
  className?: string;
}) {
  return (
    <PowerFlowView
      scene={fleetPowerFlowScene(summary)}
      renderFallback={(c) => <FleetPowerFlow summary={summary} className={c} />}
      mode={mode}
      className={className}
    />
  );
}
