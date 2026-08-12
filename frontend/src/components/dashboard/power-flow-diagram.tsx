"use client";

import type { LucideIcon } from "lucide-react";

import { PowerFlowEdge } from "@/components/dashboard/power-flow-edge";
import { PowerFlowNode } from "@/components/dashboard/power-flow-node";
import type { FlowLeg } from "@/lib/power-flow-model";
import { scalePowerFlowSpeed, scalePowerFlowWidth } from "@/lib/power-flow-scale";
import { cn } from "@/lib/utils";

// The shared 2D power-flow layout: solar above, grid left, load right, battery
// below, all converging on a hub.
//
// Extracted so the fleet view and the per-site view cannot drift apart. They
// draw the same five nodes and the same four edges; only the numbers and the
// hub's identity differ. Duplicating the SVG would have meant two places to
// keep the edge directions consistent, which is exactly the bug this whole
// change is about.

// The viewBox has to leave room for each node's full label stack (badge +
// label + value + sublabel), not just its badge — a node centred at
// `VIEW_H - 40` put its sublabel past the bottom edge, where the SVG viewport
// cut it in half. Every node below sits at least 60px from any edge, which is
// half the tallest label box.
// ~1.8:1, close to the panel's own aspect ratio, so `meet` scaling leaves only
// a thin margin instead of large dead bands either side.
const VIEW_W = 620;
const VIEW_H = 344;
const MID_Y = 172;

const POS = {
  solar: { x: VIEW_W / 2, y: 62 },
  grid: { x: 104, y: MID_Y },
  load: { x: VIEW_W - 104, y: MID_Y },
  battery: { x: VIEW_W / 2, y: 282 },
  hub: { x: VIEW_W / 2, y: MID_Y },
};

export interface FlowNodeSpec {
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel?: string;
  colorClass: string;
  bgClass: string;
}

export interface PowerFlowDiagramProps {
  solar: FlowLeg;
  grid: FlowLeg;
  load: FlowLeg;
  battery: FlowLeg;
  nodes: {
    solar: FlowNodeSpec;
    grid: FlowNodeSpec;
    load: FlowNodeSpec;
    battery: FlowNodeSpec;
    hub: FlowNodeSpec;
  };
  /** Normalizes stroke width and chevron speed across the four legs. */
  maxWatts: number;
  ariaLabel: string;
  className?: string;
}

/** Magnitude for visual scaling. An unreported leg has no width to scale. */
function magnitude(leg: FlowLeg): number {
  return leg.valueW == null ? 0 : Math.abs(leg.valueW);
}

export function PowerFlowDiagram({
  solar,
  grid,
  load,
  battery,
  nodes,
  maxWatts,
  ariaLabel,
  className,
}: PowerFlowDiagramProps) {
  return (
    <div className={cn("w-full", className)}>
      {/* Scales to fit whatever box the caller sizes, so the 2D and 3D views
          occupy identical space and toggling between them doesn't reflow the
          page — and so the wall display can cap it to the screen height. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Every edge takes its active/reverse straight from its leg. No call
            site decides direction for itself — see lib/power-flow-model. */}
        <PowerFlowEdge
          from={POS.solar}
          to={POS.hub}
          control={{ x: VIEW_W / 2, y: (POS.solar.y + MID_Y) / 2 }}
          active={solar.active}
          reverse={solar.reverse}
          speed={scalePowerFlowSpeed(magnitude(solar), maxWatts)}
          particleCount={3}
          strokeWidth={scalePowerFlowWidth(magnitude(solar), maxWatts)}
          colorVar="var(--color-solar)"
        />
        <PowerFlowEdge
          from={POS.hub}
          to={POS.load}
          control={{ x: VIEW_W * 0.76, y: MID_Y - 24 }}
          active={load.active}
          reverse={load.reverse}
          speed={scalePowerFlowSpeed(magnitude(load), maxWatts)}
          particleCount={3}
          strokeWidth={scalePowerFlowWidth(magnitude(load), maxWatts)}
          colorVar="var(--color-load)"
        />
        <PowerFlowEdge
          from={POS.grid}
          to={POS.hub}
          control={{ x: VIEW_W * 0.24, y: MID_Y + 24 }}
          active={grid.active}
          reverse={grid.reverse}
          speed={scalePowerFlowSpeed(magnitude(grid), maxWatts)}
          particleCount={2}
          strokeWidth={scalePowerFlowWidth(magnitude(grid), maxWatts)}
          colorVar="var(--color-grid)"
        />
        <PowerFlowEdge
          from={POS.battery}
          to={POS.hub}
          control={{ x: VIEW_W / 2, y: (MID_Y + POS.battery.y) / 2 }}
          active={battery.active}
          reverse={battery.reverse}
          speed={scalePowerFlowSpeed(magnitude(battery), maxWatts)}
          particleCount={2}
          strokeWidth={scalePowerFlowWidth(magnitude(battery), maxWatts)}
          colorVar="var(--color-battery)"
        />

        <FlowNode spec={nodes.solar} at={POS.solar} active={solar.active} />
        <FlowNode spec={nodes.grid} at={POS.grid} active={grid.active} />
        <FlowNode spec={nodes.load} at={POS.load} active={load.active} />
        <FlowNode spec={nodes.battery} at={POS.battery} active={battery.active} />
        <PowerFlowNode
          x={POS.hub.x}
          y={POS.hub.y}
          icon={nodes.hub.icon}
          label={nodes.hub.label}
          value={nodes.hub.value}
          sublabel={nodes.hub.sublabel}
          colorClass={nodes.hub.colorClass}
          bgClass={nodes.hub.bgClass}
          active={false}
          size={104}
          chip
        />
      </svg>
    </div>
  );
}

function FlowNode({
  spec,
  at,
  active,
}: {
  spec: FlowNodeSpec;
  at: { x: number; y: number };
  active: boolean;
}) {
  return (
    <PowerFlowNode
      x={at.x}
      y={at.y}
      icon={spec.icon}
      label={spec.label}
      value={spec.value}
      sublabel={spec.sublabel}
      colorClass={spec.colorClass}
      bgClass={spec.bgClass}
      active={active}
    />
  );
}
