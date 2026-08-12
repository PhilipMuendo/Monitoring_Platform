"use client";

import dynamic from "next/dynamic";
import { memo } from "react";

import { FleetPowerFlow } from "@/components/dashboard/fleet-power-flow";
import { PowerFlowSkeleton } from "@/components/dashboard/power-flow-skeleton";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useWebGLTier } from "@/hooks/use-webgl-support";
import type { FleetSummary } from "@/lib/types";

/**
 * Height of the flow panel. Shared by the 2D view, the 3D canvas and the
 * loading skeleton so switching modes (or finishing a load) never resizes
 * the panel and reflows the page beneath it.
 *
 * Brought back down from 520/600. Making the panel taller turned out not to
 * make the scene bigger: at a typical dashboard card width the camera fit is
 * bound by WIDTH, not height, so the extra height bought nothing but a dead
 * band under the building — clearly visible in the reported screenshot, where
 * the scene filled roughly the top 60% and the rest was empty backdrop. The
 * scene projects about 5.7 world units tall, so past ~460px at this width
 * every additional pixel is empty. Apparent size comes from the geometry
 * (the body is now 3.4 wide, up from 2.5) and from the panel getting WIDER,
 * not taller. The xl step still pays off because the card is wide enough
 * there for the fit to become height-bound.
 */
export const POWER_FLOW_BOX = "h-[380px] sm:h-[440px] xl:h-[520px]";

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
  const tier = useWebGLTier();

  if (mode !== "3d") {
    return <FleetPowerFlow summary={summary} className={className} />;
  }

  // Probing. Showing the skeleton rather than the 2D view avoids flashing a
  // diagram the user didn't ask for on the way to the 3D one; the lazy
  // chunk below is usually still downloading at this point anyway.
  if (tier === null) {
    return <PowerFlowSkeleton className={className} />;
  }

  // No WebGL — a Smart TV browser that can't create a context would
  // otherwise render an unexplained blank panel. See use-webgl-support.ts.
  if (tier === "none") {
    return <FleetPowerFlow summary={summary} className={className} />;
  }

  return <Fleet3DPowerFlow summary={summary} className={className} />;
});
