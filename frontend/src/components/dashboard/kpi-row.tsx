import { AlertTriangle, BatteryCharging, Gauge, MapPin, Sun, Zap } from "lucide-react";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatEnergy, formatPercent, formatPower } from "@/lib/format";
import type { FleetSummary } from "@/lib/types";

export function KpiRow({ summary }: { summary: FleetSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        icon={MapPin}
        label="Fleet"
        value={`${summary.online_sites}/${summary.total_sites}`}
        sublabel="sites online"
        colorClass="text-status-online"
        bgClass="bg-status-online/10"
      />
      <KpiCard
        icon={Sun}
        label="Solar output"
        value={formatPower(summary.total_power_w)}
        sublabel="right now"
        colorClass="text-solar"
        bgClass="bg-solar/10"
      />
      <KpiCard
        icon={Zap}
        label="Energy today"
        value={formatEnergy(summary.energy_today_kwh)}
        sublabel="fleet total"
        colorClass="text-solar"
        bgClass="bg-solar/10"
      />
      <KpiCard
        icon={BatteryCharging}
        label="Avg battery"
        value={formatPercent(summary.avg_soc)}
        sublabel="state of charge"
        colorClass="text-battery"
        bgClass="bg-battery/10"
      />
      <KpiCard
        icon={Gauge}
        label="Grid flow"
        value={formatPower(Math.abs(summary.total_grid_w))}
        sublabel={summary.total_grid_w >= 0 ? "importing" : "exporting"}
        colorClass="text-grid"
        bgClass="bg-grid/10"
      />
      <KpiCard
        icon={AlertTriangle}
        label="Active issues"
        value={String(summary.active_alerts)}
        sublabel={summary.active_alerts === 0 ? "all clear" : "need attention"}
        colorClass={summary.active_alerts > 0 ? "text-status-critical" : "text-status-online"}
        bgClass={summary.active_alerts > 0 ? "bg-status-critical/10" : "bg-status-online/10"}
      />
    </div>
  );
}
