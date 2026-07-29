"use client";

import { Battery, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Building2, LayoutGrid, Sun, Zap } from "lucide-react";

import { PowerFlowEdge } from "@/components/dashboard/power-flow-edge";
import { PowerFlowNode } from "@/components/dashboard/power-flow-node";
import { formatPercent, formatPower } from "@/lib/format";
import { POWER_FLOW_THRESHOLD_W, scalePowerFlowSpeed, scalePowerFlowWidth } from "@/lib/power-flow-scale";
import { cn } from "@/lib/utils";
import type { FleetSummary } from "@/lib/types";

// The viewBox has to leave room for each node's full label stack (badge +
// label + value + sublabel), not just its badge — a node centred at
// `VIEW_H - 40` put its sublabel past the bottom edge, where the SVG
// viewport cut it in half. Every node below sits at least 60px from any
// edge, which is half the tallest label box.
// ~1.8:1, close to the panel's own aspect ratio, so `meet` scaling leaves
// only a thin margin instead of large dead bands either side.
const VIEW_W = 620;
const VIEW_H = 344;
const MID_Y = 172;
const THRESHOLD_W = POWER_FLOW_THRESHOLD_W;

const POS = {
  solar: { x: VIEW_W / 2, y: 62 },
  grid: { x: 104, y: MID_Y },
  load: { x: VIEW_W - 104, y: MID_Y },
  battery: { x: VIEW_W / 2, y: 282 },
  hub: { x: VIEW_W / 2, y: MID_Y },
};

export function batteryIcon(soc: number) {
  if (soc >= 80) return BatteryFull;
  if (soc >= 45) return BatteryMedium;
  if (soc >= 15) return BatteryLow;
  if (soc > 0) return BatteryWarning;
  return Battery;
}

const scaleWidth = scalePowerFlowWidth;
const scaleSpeed = scalePowerFlowSpeed;

export function FleetPowerFlow({ summary, className }: { summary: FleetSummary; className?: string }) {
  const solarW = summary.total_power_w;
  const loadW = summary.total_load_w;
  const gridW = summary.total_grid_w;
  const batteryW = summary.total_battery_w;
  const maxWatts = Math.max(solarW, loadW, Math.abs(gridW), Math.abs(batteryW), 1000);

  const BatteryIcon = batteryIcon(summary.avg_soc);

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
        aria-label="Fleet-wide power flow"
      >
        <PowerFlowEdge
        from={POS.solar}
        to={POS.hub}
        control={{ x: VIEW_W / 2, y: (POS.solar.y + MID_Y) / 2 }}
        active={solarW > THRESHOLD_W}
        reverse={false}
        speed={scaleSpeed(solarW, maxWatts)}
        particleCount={3}
        strokeWidth={scaleWidth(solarW, maxWatts)}
        colorVar="var(--color-solar)"
      />
      <PowerFlowEdge
        from={POS.hub}
        to={POS.load}
        control={{ x: VIEW_W * 0.76, y: MID_Y - 24 }}
        active={loadW > THRESHOLD_W}
        reverse={false}
        speed={scaleSpeed(loadW, maxWatts)}
        particleCount={3}
        strokeWidth={scaleWidth(loadW, maxWatts)}
        colorVar="var(--color-load)"
      />
      <PowerFlowEdge
        from={POS.grid}
        to={POS.hub}
        control={{ x: VIEW_W * 0.24, y: MID_Y + 24 }}
        active={Math.abs(gridW) > THRESHOLD_W}
        reverse={gridW < 0}
        speed={scaleSpeed(gridW, maxWatts)}
        particleCount={2}
        strokeWidth={scaleWidth(gridW, maxWatts)}
        colorVar="var(--color-grid)"
      />
      <PowerFlowEdge
        from={POS.battery}
        to={POS.hub}
        control={{ x: VIEW_W / 2, y: (MID_Y + POS.battery.y) / 2 }}
        active={Math.abs(batteryW) > THRESHOLD_W}
        // Edge is declared battery->hub, so its non-reversed direction is
        // discharge (battery supplying the house); charging (batteryW >= 0,
        // power flowing hub->battery) is the reversed case.
        reverse={batteryW >= 0}
        speed={scaleSpeed(batteryW, maxWatts)}
        particleCount={2}
        strokeWidth={scaleWidth(batteryW, maxWatts)}
        colorVar="var(--color-battery)"
      />

      <PowerFlowNode
        x={POS.solar.x}
        y={POS.solar.y}
        icon={Sun}
        label="Solar"
        value={formatPower(solarW)}
        colorClass="text-solar"
        bgClass="bg-solar/15 border-solar/30"
        active={solarW > THRESHOLD_W}
      />
      <PowerFlowNode
        x={POS.grid.x}
        y={POS.grid.y}
        icon={Zap}
        label="Grid"
        value={formatPower(Math.abs(gridW))}
        sublabel={gridW >= 0 ? "importing" : "exporting"}
        colorClass="text-grid"
        bgClass="bg-grid/15 border-grid/30"
        active={Math.abs(gridW) > THRESHOLD_W}
      />
      <PowerFlowNode
        x={POS.load.x}
        y={POS.load.y}
        icon={Building2}
        label="Load"
        value={formatPower(loadW)}
        colorClass="text-load"
        bgClass="bg-load/15 border-load/30"
        active={loadW > THRESHOLD_W}
      />
      <PowerFlowNode
        x={POS.battery.x}
        y={POS.battery.y}
        icon={BatteryIcon}
        label="Battery"
        value={formatPercent(summary.avg_soc)}
        sublabel={`${batteryW >= 0 ? "charging" : "discharging"} ${formatPower(Math.abs(batteryW))}`}
        colorClass="text-battery"
        bgClass="bg-battery/15 border-battery/30"
        active={Math.abs(batteryW) > THRESHOLD_W}
      />
      <PowerFlowNode
        x={POS.hub.x}
        y={POS.hub.y}
        icon={LayoutGrid}
        label="Fleet"
        value={`${summary.online_sites}/${summary.total_sites}`}
        sublabel="sites online"
        colorClass="text-foreground"
        bgClass="bg-card border-border"
        active={false}
        size={104}
        chip
      />
      </svg>
    </div>
  );
}
