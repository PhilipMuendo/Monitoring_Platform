"use client";

import { Building2, Cpu, Sun, Zap } from "lucide-react";

import { batteryIcon } from "@/components/dashboard/fleet-power-flow";
import { PowerFlowDiagram } from "@/components/dashboard/power-flow-diagram";
import { formatCapacity, formatPercent, formatPower } from "@/lib/format";
import { batteryLeg, gridLeg, loadLeg, siteBatteryW, solarLeg } from "@/lib/power-flow-model";
import type { SiteWithStatus } from "@/lib/types";

/**
 * One site's power flow, in 2D.
 *
 * 2D rather than the fleet view's 3D scene deliberately: the 3D house is a
 * single aggregate illustration of the whole fleet, and rendering a WebGL scene
 * per site would cost far more than it explains — a site page wants its own
 * numbers, not a second copy of the same building.
 *
 * Every direction here comes from lib/power-flow-model, so this diagram cannot
 * claim power is flowing into the array or out of the house load. Anything the
 * inverter did not report shows as "—" and an inactive leg rather than a zero.
 */
export function SitePowerFlow({ site, className }: { site: SiteWithStatus; className?: string }) {
  const solar = solarLeg(site.power_w);
  const load = loadLeg(site.load_power_w);
  const grid = gridLeg(site.grid_power_w);
  // Derived from this site's own balance, and only when all three terms are
  // present — see siteBatteryW. Most Deye sites report no grid channel, so
  // their battery leg is honestly unknown rather than confidently wrong.
  const battery = batteryLeg(siteBatteryW(site));

  const maxWatts = Math.max(
    solar.valueW ?? 0,
    load.valueW ?? 0,
    Math.abs(grid.valueW ?? 0),
    Math.abs(battery.valueW ?? 0),
    1000,
  );

  return (
    <PowerFlowDiagram
      className={className}
      ariaLabel={`Power flow for ${site.name}`}
      maxWatts={maxWatts}
      solar={solar}
      grid={grid}
      load={load}
      battery={battery}
      nodes={{
        solar: {
          icon: Sun,
          label: "Solar",
          value: solar.valueW == null ? "—" : formatPower(solar.valueW),
          sublabel: solar.note ?? undefined,
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
          value: load.valueW == null ? "—" : formatPower(load.valueW),
          sublabel: load.note ?? undefined,
          colorClass: "text-load",
          bgClass: "bg-load/15 border-load/30",
        },
        battery: {
          icon: batteryIcon(site.soc ?? 0),
          label: "Battery",
          value: site.soc == null ? "—" : formatPercent(site.soc),
          sublabel:
            battery.valueW == null
              ? "flow not reported"
              : `${battery.note ?? "idle"} ${formatPower(Math.abs(battery.valueW))}`,
          colorClass: "text-battery",
          bgClass: "bg-battery/15 border-battery/30",
        },
        hub: {
          icon: Cpu,
          label: "Inverter",
          value: formatCapacity(site.capacity_kw),
          sublabel: site.brand,
          colorClass: "text-foreground",
          bgClass: "bg-card border-border",
        },
      }}
    />
  );
}
