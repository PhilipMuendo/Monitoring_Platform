"use client";

import { PowerFlowLabelContent, type PowerFlowLabelContentProps } from "@/components/dashboard/power-flow-label-content";

interface PowerFlowNodeProps extends PowerFlowLabelContentProps {
  x: number;
  y: number;
  /**
   * Width of the label box, independent of the badge diameter. The badge is
   * `size` across, but the text under it ("discharging 347.5 kW") is far
   * wider; sizing the foreignObject to `size` made that text wrap and spill
   * out of the SVG viewport, which clipped it mid-word.
   */
  labelWidth?: number;
}

// Rendered inside the FleetPowerFlow <svg> via foreignObject, so regular
// HTML/Tailwind can be used for the node content while it still shares
// the same coordinate space as the animated flow edges. The actual
// content is PowerFlowLabelContent, shared with the 3D scene's <Html> labels.
export function PowerFlowNode({ x, y, size = 88, labelWidth = 168, ...contentProps }: PowerFlowNodeProps) {
  // Badge + label + value + sublabel stack, centred on (x, y).
  const boxHeight = size + 44;
  return (
    <foreignObject
      x={x - labelWidth / 2}
      y={y - boxHeight / 2}
      width={labelWidth}
      height={boxHeight}
      style={{ overflow: "visible" }}
    >
      <PowerFlowLabelContent size={size} {...contentProps} />
    </foreignObject>
  );
}
