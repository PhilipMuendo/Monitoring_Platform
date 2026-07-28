"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatClockTime, formatDayLabel, formatPower } from "@/lib/format";
import type { PowerPoint } from "@/lib/types";

interface PowerHistoryChartProps {
  points: PowerPoint[];
  range: "24h" | "7d" | "30d";
}

export function PowerHistoryChart({ points, range }: PowerHistoryChartProps) {
  const tickFormatter = range === "24h" ? formatClockTime : formatDayLabel;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="solarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-solar)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-solar)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-load)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-load)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="time"
          tickFormatter={tickFormatter}
          minTickGap={40}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
        />
        <YAxis
          tickFormatter={(v) => formatPower(v)}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
          width={64}
        />
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
          labelFormatter={(v) => (range === "24h" ? formatClockTime(v as string) : formatDayLabel(v as string))}
          formatter={(value, name) => [formatPower(Number(value)), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="power_w" name="Solar" stroke="var(--color-solar)" fill="url(#solarFill)" strokeWidth={2} isAnimationActive={false} />
        <Area type="monotone" dataKey="load_w" name="Load" stroke="var(--color-load)" fill="url(#loadFill)" strokeWidth={1.5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
