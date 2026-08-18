// Mirrors backend/internal/models/models.go's JSON shapes exactly —
// field names and optionality must stay in sync with that file.

// "unknown" and "commissioning" describe the state of our knowledge, not
// the state of the site: unknown means the vendor API was unreachable this
// cycle, commissioning means the site has never reported yet. Neither
// raises an alert, and neither should be presented as an outage.
export type SiteStatus = "online" | "offline" | "warning" | "error" | "unknown" | "commissioning";
export type Brand = "deye" | "ingecon" | "sosen";
export type AlertType = "offline" | "production_drop" | "fault" | "battery_issue";
export type Severity = "critical" | "warning" | "info";
export type Role = "admin" | "technician" | "viewer";

export interface Site {
  id: string;
  name: string;
  brand: Brand;
  brand_site_id: string;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  capacity_kw: number;
  installer_account_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SiteWithStatus extends Site {
  status: SiteStatus;
  power_w?: number | null;
  energy_today_kwh?: number | null;
  energy_total_kwh?: number | null;
  soc?: number | null;
  battery_voltage?: number | null;
  battery_current?: number | null;
  grid_power_w?: number | null;
  load_power_w?: number | null;
  fault_code?: number | null;
  last_seen_at?: string | null;
}

export interface Alert {
  id: string;
  site_id: string;
  site_name?: string;
  brand?: Brand;
  type: AlertType;
  severity: Severity;
  message: string;
  details?: unknown;
  acknowledged: boolean;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface FleetSummary {
  total_sites: number;
  online_sites: number;
  offline_sites: number;
  warning_sites: number;
  error_sites: number;
  total_power_w: number;
  total_load_w: number;
  total_grid_w: number;
  /**
   * Derived from the power balance (solar + grid - load), not measured — no
   * brand reports battery current. Null when no site reports all three terms,
   * because a residual computed from partial data is a confident wrong number
   * rather than an approximate right one. See battery_sites for its coverage.
   */
  total_battery_w: number | null;
  /** How many sites total_battery_w actually covers, out of total_sites. */
  battery_sites: number;
  avg_soc: number;
  energy_today_kwh: number;
  active_alerts: number;
  data_age_seconds: number;
}

export interface PowerPoint {
  time: string;
  power_w?: number | null;
  /**
   * Highest instantaneous reading in the bucket. Present only on the hourly
   * ranges (7d/30d) — null on 24h, where each point is a single reading and
   * therefore already its own peak. On hourly ranges power_w is an AVERAGE,
   * which understates a solar peak by 39-67% on real data.
   */
  peak_power_w?: number | null;
  load_w?: number | null;
  grid_w?: number | null;
  soc?: number | null;
  energy_today_kwh?: number | null;
}

export interface SiteHistory {
  range: "24h" | "7d" | "30d";
  points: PowerPoint[];
}

export interface AuthResponse {
  access_token: string;
  // No refresh_token: it is delivered as an HttpOnly cookie the browser
  // attaches automatically, so script never sees it. That is the whole
  // point — it used to sit in localStorage, readable by any XSS.
  user: { id: string; email: string; name: string; role: Role };
}

/** One page of sites, as returned by GET /api/v1/sites. */
export interface SitePage {
  sites: SiteWithStatus[];
  total: number;
  limit: number;
  offset: number;
}

export interface HealthResponse {
  // "unhealthy" is served with HTTP 503 and was missing from this union, so
  // the one status that means "stop routing traffic here" did not typecheck.
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks?: {
    database?: { ok: boolean; latency_ms?: number; error?: string };
    collector?: { ok: boolean; last_run?: string };
  };
  metrics: {
    last_collection: string;
    total_sites: number;
    success_rate: number;
    avg_duration_ms: number;
    // `unknown` is the whole point of this map and was omitted here: it means
    // WE could not read the site, as opposed to the site being off. Counting
    // it as offline turns one broken vendor integration into an apparent
    // fleet outage — see lib/platform-status.ts.
    brands: Record<string, { online: number; offline: number; unknown: number }>;
    alerts_active: number | null;
    alerts_24h: number | null;
  };
}
