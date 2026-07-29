/**
 * Battery state-of-charge thresholds, shared so the site grid, site detail
 * and wall display all agree on what "low" looks like.
 *
 * The critical threshold is the alert engine's BatterySOCThresholdPct (20%).
 *
 * Both helpers threshold the *rounded* percentage — the same value
 * formatPercent() renders next to the bar. Comparing the raw float instead
 * splits sites that display an identical number: 19.99 and 20.46 both read
 * "20%", but one would get a red bar and the other amber, which looks like
 * a rendering bug. The colour has to agree with the number beside it first.
 *
 * Consequence worth knowing: the alert engine still fires on the raw value,
 * so a site at 19.6 shows an amber bar labelled "20%" while holding an
 * active battery alert. That gap is at most half a percentage point and the
 * alert is surfaced anyway — via the site's status badge, the issues panel,
 * and its alert history.
 */
export const SOC_CRITICAL_PCT = 20;
export const SOC_LOW_PCT = 40;

/** Tailwind background class for a SOC progress-bar fill. */
export function socIndicatorClass(soc: number): string {
  const shown = Math.round(soc);
  if (shown < SOC_CRITICAL_PCT) return "bg-status-critical";
  if (shown < SOC_LOW_PCT) return "bg-status-warning";
  return "bg-battery";
}

/** Tailwind text class for a SOC readout. */
export function socTextClass(soc: number): string {
  const shown = Math.round(soc);
  if (shown < SOC_CRITICAL_PCT) return "text-status-critical";
  if (shown < SOC_LOW_PCT) return "text-status-warning";
  return "text-battery";
}
