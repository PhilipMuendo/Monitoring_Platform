import { describe, expect, it } from "vitest";

import { formatCapacity, formatEnergy, formatPercent, formatPower } from "@/lib/format";

describe("formatPower", () => {
  it("scales through W, kW and MW", () => {
    expect(formatPower(940)).toBe("940 W");
    expect(formatPower(1500)).toBe("1.5 kW");
    expect(formatPower(2_500_000)).toBe("2.50 MW");
  });

  it("renders an em dash for an unreported channel", () => {
    // Every telemetry channel is nullable now precisely so "not reported"
    // and "zero" stay distinguishable all the way to the screen.
    expect(formatPower(null)).toBe("—");
    expect(formatPower(undefined)).toBe("—");
    expect(formatPower(NaN)).toBe("—");
  });

  it("keeps a real zero as a number", () => {
    expect(formatPower(0)).toBe("0 W");
  });

  it("handles export (negative) without losing the sign", () => {
    expect(formatPower(-1500)).toBe("-1.5 kW");
    expect(formatPower(-250)).toBe("-250 W");
  });
});

describe("formatCapacity", () => {
  // The Ingecon plant record exposes no capacity field at all, so every
  // Ingecon site arrives with capacity_kw = 0. Rendering that as "0.0 kW"
  // states a measurement we do not have — and it silently poisons any
  // performance-ratio maths downstream.
  it("shows an em dash when capacity is unknown", () => {
    expect(formatCapacity(0)).toBe("— kW");
    expect(formatCapacity(null)).toBe("— kW");
    expect(formatCapacity(undefined)).toBe("— kW");
    expect(formatCapacity(NaN)).toBe("— kW");
  });

  it("shows a known capacity to one decimal", () => {
    expect(formatCapacity(24)).toBe("24.0 kW");
    expect(formatCapacity(11.25)).toBe("11.3 kW");
  });

  it("treats a negative capacity as unknown rather than printing it", () => {
    expect(formatCapacity(-5)).toBe("— kW");
  });
});

describe("formatEnergy", () => {
  it("scales into MWh", () => {
    expect(formatEnergy(44.9)).toBe("44.9 kWh");
    expect(formatEnergy(1500)).toBe("1.50 MWh");
  });

  it("distinguishes unreported from zero", () => {
    expect(formatEnergy(null)).toBe("—");
    expect(formatEnergy(0)).toBe("0.0 kWh");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(19.6)).toBe("20%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("distinguishes unreported from zero", () => {
    expect(formatPercent(null)).toBe("—");
  });
});
