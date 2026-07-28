"use client";

import { PowerFlowLabelContent, type PowerFlowLabelContentProps } from "@/components/dashboard/power-flow-label-content";

interface PowerFlowNodeProps extends PowerFlowLabelContentProps {
  x: number;
  y: number;
}

// Rendered inside the FleetPowerFlow <svg> via foreignObject, so regular
// HTML/Tailwind can be used for the node content while it still shares
// the same coordinate space as the animated flow edges. The actual
// content is PowerFlowLabelContent, shared with the 3D scene's <Html> labels.
export function PowerFlowNode({ x, y, size = 88, ...contentProps }: PowerFlowNodeProps) {
  return (
    <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size} style={{ overflow: "visible" }}>
      <PowerFlowLabelContent size={size} {...contentProps} />
    </foreignObject>
  );
}
