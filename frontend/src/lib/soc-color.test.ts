import { describe, expect, it } from "vitest";

import { SOC_CRITICAL_PCT, SOC_LOW_PCT, socIndicatorClass, socTextClass } from "@/lib/soc-color";

describe("SOC colour thresholds", () => {
  it("colours by band", () => {
    expect(socIndicatorClass(5)).toBe("bg-status-critical");
    expect(socIndicatorClass(30)).toBe("bg-status-warning");
    expect(socIndicatorClass(85)).toBe("bg-battery");
  });

  it("keeps the text helper in step with the bar", () => {
    for (const soc of [0, 19, 20, 39, 40, 100]) {
      const bar = socIndicatorClass(soc).replace("bg-", "");
      const text = socTextClass(soc).replace("text-", "");
      expect(text, `SOC ${soc}% should use the same colour for bar and label`).toBe(bar);
    }
  });

  // The reason both helpers round before comparing: 19.99 and 20.46 both
  // render as "20%", and giving one a red bar and the other amber looks
  // like a rendering bug. The colour must agree with the number beside it.
  it("thresholds the displayed value, not the raw float", () => {
    expect(socIndicatorClass(19.99)).toBe(socIndicatorClass(20.46));
    expect(socIndicatorClass(19.99)).toBe("bg-status-warning");

    // 19.4 rounds to 19, which is genuinely below the threshold.
    expect(socIndicatorClass(19.4)).toBe("bg-status-critical");
  });

  it("treats the thresholds as exclusive lower bounds", () => {
    expect(socIndicatorClass(SOC_CRITICAL_PCT - 1)).toBe("bg-status-critical");
    expect(socIndicatorClass(SOC_CRITICAL_PCT)).toBe("bg-status-warning");
    expect(socIndicatorClass(SOC_LOW_PCT - 1)).toBe("bg-status-warning");
    expect(socIndicatorClass(SOC_LOW_PCT)).toBe("bg-battery");
  });

  it("handles the extremes without throwing", () => {
    expect(socIndicatorClass(0)).toBe("bg-status-critical");
    expect(socIndicatorClass(100)).toBe("bg-battery");
    // Vendors occasionally report nonsense; a colour helper must not be
    // the thing that breaks the page.
    expect(() => socIndicatorClass(-5)).not.toThrow();
    expect(() => socIndicatorClass(120)).not.toThrow();
  });

  it("keeps the critical threshold aligned with the alert engine", () => {
    // alertengine.DefaultConfig().BatterySOCThresholdPct
    expect(SOC_CRITICAL_PCT).toBe(20);
  });
});
