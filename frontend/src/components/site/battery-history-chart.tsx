"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartTooltip } from "@/components/site/chart-tooltip";
import { formatClockTime, formatDayLabel, formatPercent } from "@/lib/format";
import type { PowerPoint } from "@/lib/types";

interface BatteryHistoryChartProps {
  points: PowerPoint[];
  range: "24h" | "7d" | "30d";
}

export function BatteryHistoryChart({ points, range }: BatteryHistoryChartProps) {
  const tickFormatter = range === "24h" ? formatClockTime : formatDayLabel;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="batteryFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-battery)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-battery)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="time" tickFormatter={tickFormatter} minTickGap={40} stroke="var(--color-muted-foreground)" fontSize={11} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke="var(--color-muted-foreground)" fontSize={11} width={40} />
        <Tooltip
          cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
          content={
            <ChartTooltip
              labelFormatter={(v) => (range === "24h" ? formatClockTime(v) : formatDayLabel(v))}
              valueFormatter={formatPercent}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="soc"
          name="Battery SOC"
          stroke="var(--color-battery)"
          fill="url(#batteryFill)"
          strokeWidth={2}
          isAnimationActive
          animationDuration={700}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
