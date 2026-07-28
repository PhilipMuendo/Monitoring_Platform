// Mirrors backend/internal/models/models.go's JSON shapes exactly —
// field names and optionality must stay in sync with that file.

export type SiteStatus = "online" | "offline" | "warning" | "error";
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
  total_battery_w: number;
  avg_soc: number;
  energy_today_kwh: number;
  active_alerts: number;
  data_age_seconds: number;
}

export interface PowerPoint {
  time: string;
  power_w?: number | null;
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
  refresh_token: string;
  user: { id: string; email: string; name: string; role: Role };
}

export interface HealthResponse {
  status: "healthy" | "degraded";
  timestamp: string;
  metrics: {
    last_collection: string;
    total_sites: number;
    success_rate: number;
    avg_duration_ms: number;
    brands: Record<string, { online: number; offline: number }>;
    alerts_active: number;
    alerts_24h: number;
  };
}
