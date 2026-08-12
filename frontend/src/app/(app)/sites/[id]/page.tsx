"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Battery, CalendarDays, Gauge, MapPin, Sun, TrendingUp, Zap } from "lucide-react";

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
import { formatCapacity, formatEnergy, formatPercent, formatPower, formatRelativeTime } from "@/lib/format";
import { socTextClass } from "@/lib/soc-color";

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
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (isError || !site) {
    return (
      <div className="space-y-4">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this site. It may have been removed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{site.name}</h1>
          <BrandBadge brand={site.brand} />
          <StatusBadge status={site.status} />
        </div>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5" />
          {site.location} · {formatCapacity(site.capacity_kw)} capacity · last seen {formatRelativeTime(site.last_seen_at)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={Sun} label="Solar" value={formatPower(site.power_w)} colorClass="text-solar" bgClass="bg-solar/10" />
        <KpiCard icon={Zap} label="Load" value={formatPower(site.load_power_w)} colorClass="text-load" bgClass="bg-load/10" />
        {/* Null grid_power_w means the brand never reported grid flow (every
            Deye site), not a measured zero. Coercing it to 0 rendered a
            confident "0 W importing" for a quantity we do not have — the same
            trap formatCapacity documents. Pass null through so it reads "—",
            and drop the direction label when there is no direction. */}
        <KpiCard
          icon={Gauge}
          label="Grid"
          value={formatPower(site.grid_power_w == null ? null : Math.abs(site.grid_power_w))}
          sublabel={site.grid_power_w == null ? undefined : site.grid_power_w >= 0 ? "importing" : "exporting"}
          colorClass="text-grid"
          bgClass="bg-grid/10"
        />
        <KpiCard
          icon={Battery}
          label="Battery"
          value={formatPercent(site.soc)}
          colorClass={site.soc != null ? socTextClass(site.soc) : "text-battery"}
          bgClass="bg-battery/10"
        />
        <KpiCard
          icon={CalendarDays}
          label="Energy today"
          value={formatEnergy(site.energy_today_kwh)}
          colorClass="text-solar"
          bgClass="bg-solar/10"
        />
        <KpiCard
          icon={TrendingUp}
          label="Energy total"
          value={formatEnergy(site.energy_total_kwh)}
          colorClass="text-solar"
          bgClass="bg-solar/10"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Power History</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
            <TabsList>
              <TabsTrigger value="24h">24 hours</TabsTrigger>
              <TabsTrigger value="7d">7 days</TabsTrigger>
              <TabsTrigger value="30d">30 days</TabsTrigger>
            </TabsList>
            <TabsContent value={range} className="space-y-4">
              {historyLoading || !history ? (
                <Skeleton className="h-72 w-full" />
              ) : !history.points?.length ? (
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
