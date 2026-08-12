import { describe, expect, it } from "vitest";

import { batteryLeg, gridLeg, loadLeg, siteBatteryW, solarLeg } from "@/lib/power-flow-model";
import { POWER_FLOW_THRESHOLD_W } from "@/lib/power-flow-scale";
import type { SiteWithStatus } from "@/lib/types";

const ABOVE = POWER_FLOW_THRESHOLD_W + 100;

function site(over: Partial<SiteWithStatus> = {}): SiteWithStatus {
  return {
    id: "s1",
    name: "Site",
    brand: "deye",
    brand_site_id: "b1",
    location: "Nairobi",
    capacity_kw: 10,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "online",
    ...over,
  } as SiteWithStatus;
}

describe("solarLeg — power must never flow into the panels", () => {
  it("flows forward when generating", () => {
    expect(solarLeg(ABOVE)).toMatchObject({ active: true, reverse: false });
  });

  it("never reverses on a negative reading", () => {
    // Some inverters report a small negative PV figure overnight. Drawing that
    // as power flowing up into the array is the error this guards.
    const leg = solarLeg(-500);
    expect(leg.reverse).toBe(false);
    expect(leg.active).toBe(false);
    expect(leg.valueW).toBe(0);
  });

  it("is inactive below the threshold rather than reversed", () => {
    expect(solarLeg(1)).toMatchObject({ active: false, reverse: false });
  });

  it("reports null as not reported, not as zero", () => {
    expect(solarLeg(null)).toMatchObject({ valueW: null, active: false, note: "not reported" });
    expect(solarLeg(undefined).note).toBe("not reported");
  });

  it("treats NaN as not reported", () => {
    expect(solarLeg(NaN).valueW).toBeNull();
  });
});

describe("loadLeg — power must never flow out of the house load", () => {
  it("flows forward when consuming", () => {
    expect(loadLeg(ABOVE)).toMatchObject({ active: true, reverse: false });
  });

  it("never reverses on a negative reading", () => {
    expect(loadLeg(-800)).toMatchObject({ active: false, reverse: false, valueW: 0 });
  });

  it("distinguishes null from zero", () => {
    expect(loadLeg(null).note).toBe("not reported");
    expect(loadLeg(0).note).toBeNull();
  });
});

describe("gridLeg", () => {
  it("imports forward on a positive value", () => {
    expect(gridLeg(ABOVE)).toMatchObject({ active: true, reverse: false, note: "importing" });
  });

  it("exports in reverse on a negative value", () => {
    expect(gridLeg(-ABOVE)).toMatchObject({ active: true, reverse: true, note: "exporting" });
  });

  it("is idle, not importing, when below the threshold", () => {
    expect(gridLeg(5)).toMatchObject({ active: false, note: "idle" });
  });

  it("reports null as not reported — the 12 sites with no grid channel", () => {
    expect(gridLeg(null)).toMatchObject({ valueW: null, active: false, note: "not reported" });
  });
});

describe("batteryLeg", () => {
  it("charges in reverse (hub -> battery)", () => {
    expect(batteryLeg(ABOVE)).toMatchObject({ active: true, reverse: true, note: "charging" });
  });

  it("discharges forward (battery -> hub)", () => {
    expect(batteryLeg(-ABOVE)).toMatchObject({ active: true, reverse: false, note: "discharging" });
  });

  it("reports null as not reported", () => {
    expect(batteryLeg(null).note).toBe("not reported");
  });
});

describe("battery discharging into the load", () => {
  // The diagram is battery -> hub -> load, so a discharging battery powering
  // the house must leave BOTH legs forward: power reads as a continuous run
  // from the battery, through the inverter, out to the load. Nothing in the
  // "never reverse" rules for solar and load may block that path.
  it("runs battery -> hub -> load with no reversal on either leg", () => {
    const battery = batteryLeg(-ABOVE); // discharging
    const load = loadLeg(ABOVE);

    expect(battery).toMatchObject({ active: true, reverse: false, note: "discharging" });
    expect(load).toMatchObject({ active: true, reverse: false });
  });

  it("still runs battery -> load overnight with no solar and no grid", () => {
    // The common island case: dark, no grid channel reported, house running
    // off the battery. Solar must stay inactive rather than reversed, and the
    // battery -> load path must still read.
    const solar = solarLeg(0);
    const grid = gridLeg(null);
    const battery = batteryLeg(-ABOVE);
    const load = loadLeg(ABOVE);

    expect(solar).toMatchObject({ active: false, reverse: false });
    expect(grid.active).toBe(false);
    expect(battery).toMatchObject({ active: true, reverse: false });
    expect(load).toMatchObject({ active: true, reverse: false });
  });

  it("reverses only the battery leg when charging, leaving load forward", () => {
    expect(batteryLeg(ABOVE).reverse).toBe(true);
    expect(loadLeg(ABOVE).reverse).toBe(false);
  });
});

describe("siteBatteryW — derived only from a complete balance", () => {
  it("derives from solar + grid - load", () => {
    expect(siteBatteryW(site({ power_w: 5000, grid_power_w: 1000, load_power_w: 2000 }))).toBe(4000);
  });

  it("is negative when the house draws more than solar plus import", () => {
    expect(siteBatteryW(site({ power_w: 1000, grid_power_w: 0, load_power_w: 3000 }))).toBe(-2000);
  });

  it("is null when grid is unreported, rather than treating it as zero", () => {
    // The Deye case: 8 sites report no grid channel at all. Substituting 0
    // would show the entire solar surplus as battery charging.
    expect(siteBatteryW(site({ power_w: 5000, grid_power_w: null, load_power_w: 2000 }))).toBeNull();
  });

  it("is null when load is unreported", () => {
    expect(siteBatteryW(site({ power_w: 5000, grid_power_w: 100, load_power_w: null }))).toBeNull();
  });

  it("is null when solar is unreported", () => {
    expect(siteBatteryW(site({ power_w: null, grid_power_w: 100, load_power_w: 2000 }))).toBeNull();
  });

  it("still derives when a reported value is genuinely zero", () => {
    expect(siteBatteryW(site({ power_w: 0, grid_power_w: 0, load_power_w: 0 }))).toBe(0);
  });
});
