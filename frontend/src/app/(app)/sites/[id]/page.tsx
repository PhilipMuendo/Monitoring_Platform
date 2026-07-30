"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Battery, Gauge, MapPin, Sun, Zap } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandBadge } from "@/components/brand-badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { BatteryHistoryChart } from "@/components/site/battery-history-chart";
import { PowerHistoryChart } from "@/components/site/power-history-chart";
import { SiteAlertsList } from "@/components/site/site-alerts-list";
import { useSiteHistory } from "@/hooks/use-site-history";
import { useSite } from "@/hooks/use-sites";
import { formatEnergy, formatPercent, formatPower, formatRelativeTime } from "@/lib/format";

type Range = "24h" | "7d" | "30d";

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<Range>("24h");

  const { data: site, isLoading: siteLoading, isError } = useSite(id);
  const { data: history, isLoading: historyLoading } = useSiteHistory(id, range);

  if (siteLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (isError || !site) {
    return (
      <div className="space-y-4">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to fleet
        </Link>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this site. It may have been removed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/"
          className="label-caps inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Fleet
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">{site.name}</h1>
          <BrandBadge brand={site.brand} />
          <StatusBadge status={site.status} />
        </div>
        <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <MapPin className="size-3.5" />
          {site.location} · {site.capacity_kw.toFixed(1)} kW capacity · last seen {formatRelativeTime(site.last_seen_at)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={Sun} label="Solar" value={formatPower(site.power_w)} colorClass="text-solar" accentClass="bg-solar" />
        <KpiCard icon={Zap} label="Load" value={formatPower(site.load_power_w)} colorClass="text-load" accentClass="bg-load" />
        <KpiCard
          icon={Gauge}
          label="Grid"
          value={formatPower(Math.abs(site.grid_power_w ?? 0))}
          sublabel={(site.grid_power_w ?? 0) >= 0 ? "importing" : "exporting"}
          colorClass="text-grid"
          accentClass="bg-grid"
        />
        <KpiCard icon={Battery} label="Battery" value={formatPercent(site.soc)} colorClass="text-battery" accentClass="bg-battery" />
        <KpiCard icon={Sun} label="Energy today" value={formatEnergy(site.energy_today_kwh)} colorClass="text-solar" accentClass="bg-solar" />
        <KpiCard icon={Sun} label="Energy total" value={formatEnergy(site.energy_total_kwh)} colorClass="text-solar" accentClass="bg-solar" />
      </div>

      <Card className="gap-3 rounded-sm py-3">
        <CardHeader className="px-4">
          <CardTitle className="label-caps text-xs font-semibold text-muted-foreground">Power History</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
            <TabsList className="h-7">
              <TabsTrigger value="24h" className="text-xs">
                24 hours
              </TabsTrigger>
              <TabsTrigger value="7d" className="text-xs">
                7 days
              </TabsTrigger>
              <TabsTrigger value="30d" className="text-xs">
                30 days
              </TabsTrigger>
            </TabsList>
            <TabsContent value={range} className="space-y-4 pt-3">
              {historyLoading || !history ? (
                <Skeleton className="h-72 w-full" />
              ) : history.points.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No data for this period yet.</p>
              ) : (
                <>
                  <PowerHistoryChart points={history.points} range={range} />
                  <BatteryHistoryChart points={history.points} range={range} />
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <SiteAlertsList siteId={site.id} />
    </div>
  );
}
