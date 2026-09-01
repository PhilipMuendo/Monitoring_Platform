"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Battery, CalendarDays, Gauge, MapPin, Sun, TrendingUp, Zap } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandBadge } from "@/components/brand-badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { SitePowerFlowView } from "@/components/site/site-power-flow-view";

// Recharts is 357 KB — the single largest dependency on this route, bigger
// than everything else the page needs put together. Imported statically it sat
// on the critical path, so the header, KPI cards and power flow all waited on
// a charting library before anything painted. Behind next/dynamic it streams
// alongside the history fetch the charts need anyway, and never loads at all
// for someone who opens a site and navigates away.
//
// ONE boundary around both charts, not one each: separate dynamic imports gave
// each its own copy of Recharts and grew the bundle by 357 KB. See
// site-history-charts.tsx.
//
// ssr:false because Recharts measures its container to size the SVG, which
// needs a real layout; server-rendering it yields a zero-width chart that
// resizes on hydration.
const SiteHistoryCharts = dynamic(
  () => import("@/components/site/site-history-charts").then((m) => m.SiteHistoryCharts),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
import { SiteAlertsList } from "@/components/site/site-alerts-list";
import { SkeletonList } from "@/components/skeleton-list";
import { useEnumQueryParam } from "@/hooks/use-query-param";
import { usePowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useSiteHistory } from "@/hooks/use-site-history";
import { useSite } from "@/hooks/use-sites";
import { formatCapacity, formatEnergy, formatPercent, formatPower, formatRelativeTime } from "@/lib/format";
import { socTextClass } from "@/lib/soc-color";

const RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  // In the URL rather than useState so a refresh keeps the range, and so a
  // link pasted into chat opens on the window the sender was looking at.
  const [range, setRange] = useEnumQueryParam<Range>("range", RANGES, "24h");
  // The same stored 2D/3D preference the dashboard and wall use. Read-only
  // here: one toggle for the whole app is less confusing than a per-page one,
  // and it means someone who chose 2D once is not asked again on every site.
  const { mode } = usePowerFlowViewMode();

  const { data: site, isLoading: siteLoading, isError } = useSite(id);
  const { data: history, isLoading: historyLoading } = useSiteHistory(id, range);

  if (siteLoading) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">Loading site</span>
        <Skeleton className="h-8 w-64" aria-hidden="true" />
        <Skeleton className="h-32 w-full" aria-hidden="true" />
        <Skeleton className="h-80 w-full" aria-hidden="true" />
      </div>
    );
  }

  if (isError || !site) {
    return (
      <div className="space-y-4">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to dashboard
        </Link>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this site. It may have been removed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{site.name}</h1>
          <BrandBadge brand={site.brand} />
          <StatusBadge status={site.status} />
        </div>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden="true" />
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

      {/* The 3D scene, driven by THIS site's telemetry.

          This card used to read "a WebGL scene per site would cost far more
          than it explains", and that was true when it was written: the scene
          was a 1.3 MB chunk plus a 4 MB car model whose download did not begin
          until after an auth round trip. Three changes retired the objection —
          the model was removed (the scene is fully procedural), the
          ambient-occlusion pass was split into its own chunk, and the warm-up
          moved above the auth gate.

          What settles it is that the cost does not scale with site count. The
          scene is one lazily-loaded chunk, resolved once per session and
          shared by every route, so this page adds ZERO download on top of the
          dashboard. What is left per visit is a WebGL context and a shader
          compile, and the 2D diagram holds the panel through it.

          Falls back to 2D below 768px and on devices without WebGL — see
          site-power-flow-view.tsx. */}
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Power Flow</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SitePowerFlowView site={site} mode={mode} className="h-[320px] sm:h-[380px] xl:h-[440px]" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Power History</h2>
          </CardTitle>
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
                <SiteHistoryCharts points={history.points} range={range} />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <SiteAlertsList siteId={site.id} />
    </div>
  );
}

export default function SiteDetailPage() {
  // useEnumQueryParam reads useSearchParams, which needs a boundary above it.
  return (
    <Suspense fallback={<SkeletonList count={3} className="h-32" label="Loading site" gap="space-y-4" />}>
      <SiteDetail />
    </Suspense>
  );
}
