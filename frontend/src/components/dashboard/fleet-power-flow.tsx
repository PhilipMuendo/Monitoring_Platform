"use client";

import { Battery, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Building2, LayoutGrid, Sun, Zap } from "lucide-react";

import { PowerFlowDiagram } from "@/components/dashboard/power-flow-diagram";
import { formatPercent, formatPower } from "@/lib/format";
import { batteryLeg, gridLeg, loadLeg, solarLeg, type FlowLeg } from "@/lib/power-flow-model";
import type { FleetSummary } from "@/lib/types";

export function batteryIcon(soc: number) {
  if (soc >= 80) return BatteryFull;
  if (soc >= 45) return BatteryMedium;
  if (soc >= 15) return BatteryLow;
  if (soc > 0) return BatteryWarning;
  return Battery;
}

/**
 * The fleet battery figure is a residual over only those sites reporting a
 * complete power balance, so it states its coverage whenever that is not the
 * whole fleet. Without it, "charging 12 kW" reads as a fleet-wide claim when it
 * may speak for eight sites out of twenty.
 */
function batterySublabel(summary: FleetSummary, leg: FlowLeg): string {
  if (leg.valueW == null) return "flow not reported";
  const flow = `${leg.note ?? "idle"} ${formatPower(Math.abs(leg.valueW))}`;
  return summary.battery_sites < summary.total_sites
    ? `${flow} · ${summary.battery_sites}/${summary.total_sites} sites`
    : flow;
}

export function FleetPowerFlow({ summary, className }: { summary: FleetSummary; className?: string }) {
  // Direction and null-vs-zero semantics come from lib/power-flow-model, so
  // this view cannot disagree with the site view about which way power flows.
  const solar = solarLeg(summary.total_power_w);
  const load = loadLeg(summary.total_load_w);
  const grid = gridLeg(summary.total_grid_w);
  const battery = batteryLeg(summary.total_battery_w);

  const maxWatts = Math.max(
    summary.total_power_w,
    summary.total_load_w,
    Math.abs(summary.total_grid_w),
    Math.abs(battery.valueW ?? 0),
    1000,
  );

  return (
    <PowerFlowDiagram
      className={className}
      ariaLabel="Fleet-wide power flow"
      maxWatts={maxWatts}
      solar={solar}
      grid={grid}
      load={load}
      battery={battery}
      nodes={{
        solar: {
          icon: Sun,
          label: "Solar",
          value: formatPower(summary.total_power_w),
          colorClass: "text-solar",
          bgClass: "bg-solar/15 border-solar/30",
        },
        grid: {
          icon: Zap,
          label: "Grid",
          value: grid.valueW == null ? "—" : formatPower(Math.abs(grid.valueW)),
          sublabel: grid.note ?? undefined,
          colorClass: "text-grid",
          bgClass: "bg-grid/15 border-grid/30",
        },
        load: {
          icon: Building2,
          label: "Load",
          value: formatPower(summary.total_load_w),
          colorClass: "text-load",
          bgClass: "bg-load/15 border-load/30",
        },
        battery: {
          icon: batteryIcon(summary.avg_soc),
          label: "Battery",
          value: formatPercent(summary.avg_soc),
          sublabel: batterySublabel(summary, battery),
          colorClass: "text-battery",
          bgClass: "bg-battery/15 border-battery/30",
        },
        hub: {
          icon: LayoutGrid,
          label: "Fleet",
          value: `${summary.online_sites}/${summary.total_sites}`,
          sublabel: "sites online",
          colorClass: "text-foreground",
          bgClass: "bg-card border-border",
        },
      }}
    />
  );
}
