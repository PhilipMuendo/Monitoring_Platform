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

export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  warning: "Warning",
  error: "Fault",
};

export const BRAND_LABEL: Record<string, string> = {
  deye: "Deye",
  ingecon: "Ingecon",
  sosen: "Sosen",
};
