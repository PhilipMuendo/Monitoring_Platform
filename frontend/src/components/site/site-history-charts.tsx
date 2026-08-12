"use client";

import { BatteryHistoryChart } from "@/components/site/battery-history-chart";
import { PowerHistoryChart } from "@/components/site/power-history-chart";
import type { PowerPoint } from "@/lib/types";

/**
 * Both history charts behind a SINGLE lazy boundary.
 *
 * They were briefly imported as two separate next/dynamic components, which
 * duplicated Recharts: each boundary pulled its own copy and the bundle grew
 * from 2.9 MB to 3.3 MB — 357 KB twice instead of once. One boundary around
 * both keeps Recharts in a single chunk while still keeping it off the route's
 * critical path.
 *
 * Anything else that needs Recharts on this route should be added HERE rather
 * than given its own dynamic import, for the same reason.
 */
export function SiteHistoryCharts({
  points,
  range,
}: {
  points: PowerPoint[];
  range: "24h" | "7d" | "30d";
}) {
  return (
    <>
      <PowerHistoryChart points={points} range={range} />
      <BatteryHistoryChart points={points} range={range} />
    </>
  );
}
