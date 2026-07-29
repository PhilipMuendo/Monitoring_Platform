"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { toTimeSeries, type HistoryRange } from "@/lib/chart-series";
import { formatClockTime, formatDateTime, formatDayLabel, formatPercent } from "@/lib/format";
import type { PowerPoint } from "@/lib/types";

interface BatteryHistoryChartProps {
  points: PowerPoint[];
  range: HistoryRange;
}

export function BatteryHistoryChart({ points, range }: BatteryHistoryChartProps) {
  const data = useMemo(() => toTimeSeries(points, range), [points, range]);
  const tickFormatter = range === "24h" ? formatClockTime : formatDayLabel;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="batteryFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-battery)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-battery)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        {/* Time scale + null gap rows — see toTimeSeries in lib/chart-series. */}
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={tickFormatter}
          minTickGap={40}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
        />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke="var(--color-muted-foreground)" fontSize={11} width={40} />
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
          labelFormatter={(v) => formatDateTime(v as number)}
          formatter={(value) => [formatPercent(Number(value)), "Battery SOC"]}
        />
        <Area type="monotone" dataKey="soc" stroke="var(--color-battery)" fill="url(#batteryFill)" strokeWidth={2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
