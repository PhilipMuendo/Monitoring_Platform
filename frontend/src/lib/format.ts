// Shared display formatting for power/energy/time values used across the
// KPI cards, site grid, power-flow visualization, and detail charts.

export function formatPower(watts: number | null | undefined): string {
  if (watts == null || Number.isNaN(watts)) return "—";
  const abs = Math.abs(watts);
  if (abs >= 1_000_000) return `${(watts / 1_000_000).toFixed(2)} MW`;
  if (abs >= 1_000) return `${(watts / 1_000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}

export function formatEnergy(kwh: number | null | undefined): string {
  if (kwh == null || Number.isNaN(kwh)) return "—";
  if (Math.abs(kwh) >= 1_000) return `${(kwh / 1_000).toFixed(2)} MWh`;
  return `${kwh.toFixed(1)} kWh`;
}

/**
 * Installed capacity, or an em dash when it isn't known.
 *
 * Zero is treated as "unknown", not as a real 0 kW array — no site in the
 * fleet has a zero-kilowatt installation, and the Ingecon plant record
 * exposes no capacity field at all, so every Ingecon site arrives with
 * capacity_kw = 0 until someone types it into the admin UI. Rendering that
 * as "0.0 kW" states a measurement we do not have, and it silently poisons
 * any performance-ratio maths downstream.
 */
export function formatCapacity(kw: number | null | undefined): string {
  if (kw == null || Number.isNaN(kw) || kw <= 0) return "— kW";
  return `${kw.toFixed(1)} kW`;
}

export function formatPercent(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  return `${Math.round(pct)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

// Accept epoch-ms as well as an ISO string: the history charts run on a
// numeric time axis and hand these formatters raw timestamps.
export function formatClockTime(value: string | number): string {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(value: string | number): string {
  return new Date(value).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Date + time, for tooltips on a time axis and for the alert record.
 *
 * Carries the timezone abbreviation, which it previously did not. The fleet
 * is distributed and the people reading it are not all in one place, so a
 * bare "14:32" is ambiguous the moment two of them discuss the same alert:
 * each browser rendered the instant in its own local zone and neither string
 * said so. Adding the short zone name makes the reading self-describing at
 * the cost of four characters.
 *
 * `timeZoneName: "short"` resolves against the viewer's own zone, so a
 * technician in Nairobi reads EAT and a reviewer elsewhere reads theirs —
 * both correct, and now both labelled.
 */
export function formatDateTime(value: string | number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  })}`;
}

export const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  warning: "Warning",
  error: "Fault",
  // Deliberately not "Offline". These say we could not see the site, or
  // have not seen it yet — presenting either as an outage is what made a
  // vendor API blip look like a fleet-wide failure.
  unknown: "No data",
  commissioning: "Commissioning",
};

export const BRAND_LABEL: Record<string, string> = {
  deye: "Deye",
  ingecon: "Ingecon",
  sosen: "Sosen",
};
