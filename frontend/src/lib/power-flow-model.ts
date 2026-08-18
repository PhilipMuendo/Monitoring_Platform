import { POWER_FLOW_THRESHOLD_W } from "@/lib/power-flow-scale";
import type { FleetSummary, SiteWithStatus } from "@/lib/types";

/**
 * Turns raw telemetry into the four flow legs a power-flow diagram draws.
 *
 * This exists so the direction rules live in ONE tested place instead of being
 * restated at every call site. Two of them are physical facts, not preferences:
 *
 *   - Power never flows INTO the solar array. PV is a source. A negative or
 *     absent reading means "not generating", never "consuming", and must never
 *     animate backwards up the panel leg.
 *   - Power never flows INTO the house load. Load is a sink.
 *
 * The other two legs are genuinely bidirectional and carry a sign convention
 * normalized at the adapter boundary (see docs/API.md):
 *
 *   - grid:    positive = importing from the grid, negative = exporting to it.
 *   - battery: positive = charging, negative = discharging.
 *
 * Absent is not zero anywhere here. A null reading yields an inactive leg
 * labelled "not reported" rather than an idle one, because "no flow" is a
 * measurement and "we were never told" is not.
 */
export interface FlowLeg {
  /** Signed watts as reported. Null when the value was not reported at all. */
  valueW: number | null;
  /** Enough power is moving to be worth animating. */
  active: boolean;
  /** Flow runs opposite to the edge's declared source -> target direction. */
  reverse: boolean;
  /** Short status for the node label: null when the plain value says enough. */
  note: string | null;
}

const NOT_REPORTED: FlowLeg = { valueW: null, active: false, reverse: false, note: "not reported" };

function reported(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}

/**
 * Solar. Declared array -> hub, and NEVER reversed.
 *
 * A negative reading is treated as not generating rather than as consumption:
 * some inverters report a small negative PV figure overnight (self-consumption
 * of the tracker), and drawing that as power flowing up into the panels is
 * both physically wrong and the single most obvious error in the diagram.
 */
export function solarLeg(powerW: number | null | undefined): FlowLeg {
  const v = reported(powerW);
  if (v == null) return NOT_REPORTED;
  return { valueW: Math.max(0, v), active: v > POWER_FLOW_THRESHOLD_W, reverse: false, note: null };
}

/** House load. Declared hub -> load, and never reversed for the same reason. */
export function loadLeg(loadW: number | null | undefined): FlowLeg {
  const v = reported(loadW);
  if (v == null) return NOT_REPORTED;
  return { valueW: Math.max(0, v), active: v > POWER_FLOW_THRESHOLD_W, reverse: false, note: null };
}

/** Grid. Declared grid -> hub, so importing is forward and exporting reverses. */
export function gridLeg(gridW: number | null | undefined): FlowLeg {
  const v = reported(gridW);
  if (v == null) return NOT_REPORTED;
  const active = Math.abs(v) > POWER_FLOW_THRESHOLD_W;
  return {
    valueW: v,
    active,
    reverse: v < 0,
    note: active ? (v < 0 ? "exporting" : "importing") : "idle",
  };
}

/** Battery. Declared battery -> hub, so discharging is forward and charging reverses. */
export function batteryLeg(batteryW: number | null | undefined): FlowLeg {
  const v = reported(batteryW);
  if (v == null) return NOT_REPORTED;
  const active = Math.abs(v) > POWER_FLOW_THRESHOLD_W;
  return {
    valueW: v,
    active,
    reverse: v >= 0,
    note: active ? (v >= 0 ? "charging" : "discharging") : "idle",
  };
}

/**
 * Battery power for a single site, derived from its own power balance.
 *
 * No brand in this fleet reports battery current, so there is nothing to
 * measure and the residual is the only route to a figure at all:
 *
 *     solar + grid_import - load = battery charging
 *
 * Null unless ALL THREE terms are reported for this site. Substituting zero for
 * a missing term does not produce an approximate battery reading, it produces a
 * confident wrong one — a site that reports no grid would show its entire solar
 * surplus as battery charging. Twelve of the twenty sites report no grid at all.
 */
export function siteBatteryW(site: SiteWithStatus): number | null {
  const solar = reported(site.power_w);
  const grid = reported(site.grid_power_w);
  const load = reported(site.load_power_w);
  if (solar == null || grid == null || load == null) return null;
  return solar + grid - load;
}

/**
 * Everything the 3D scene needs to draw ONE installation.
 *
 * The scene used to take a FleetSummary directly, which quietly made it a
 * fleet-only component: it read total_power_w, avg_soc, online_sites and so
 * on, so pointing it at a single site meant either inventing a fake summary or
 * forking the renderer. Neither is acceptable when the plan is one scene per
 * site page — a fork is how the fleet view and the site view start disagreeing
 * about which way the grid arrow points.
 *
 * So the scene now takes THIS: four legs, a state of charge, and an optional
 * caption. Nothing in it knows whether it describes twenty sites or one, which
 * is what makes "no per-site scripts" true rather than aspirational — both
 * builders below run the same solarLeg/gridLeg/loadLeg/batteryLeg functions
 * that the 2D diagrams already use, so direction is derived from telemetry in
 * exactly one place for every surface in the app.
 */
export interface PowerFlowScene {
  solar: FlowLeg;
  load: FlowLeg;
  grid: FlowLeg;
  battery: FlowLeg;
  /** Battery state of charge, 0-100. Null when the inverter did not report it. */
  soc: number | null;
  /**
   * Small caption drawn in the scene's bottom-left corner, or null for none.
   *
   * The fleet uses it for "13/20 sites online". A site page passes null: its
   * name and status are already in the page header a few centimetres above,
   * and repeating them inside the render is the same duplication that got the
   * KpiRow removed from the wall.
   */
  caption: { value: string; muted?: string; label: string } | null;
}

/** The whole fleet as one illustrative installation. */
export function fleetPowerFlowScene(summary: FleetSummary): PowerFlowScene {
  return {
    solar: solarLeg(summary.total_power_w),
    load: loadLeg(summary.total_load_w),
    grid: gridLeg(summary.total_grid_w),
    battery: batteryLeg(summary.total_battery_w),
    soc: summary.avg_soc,
    caption: {
      value: String(summary.online_sites),
      muted: `/${summary.total_sites}`,
      label: "sites online",
    },
  };
}

/**
 * One site.
 *
 * The battery leg comes from siteBatteryW, so it is null unless this site
 * reports solar, grid AND load — twelve of twenty sites report no grid at all,
 * and those must render an unknown battery rather than a confident wrong one.
 * SOC is separate: the inverter reports it directly, so a site can have a
 * known charge level and an unknown charge/discharge direction at once.
 */
export function sitePowerFlowScene(site: SiteWithStatus): PowerFlowScene {
  return {
    solar: solarLeg(site.power_w),
    load: loadLeg(site.load_power_w),
    grid: gridLeg(site.grid_power_w),
    battery: batteryLeg(siteBatteryW(site)),
    soc: site.soc ?? null,
    caption: null,
  };
}
