"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { toTimeSeries, type HistoryRange } from "@/lib/chart-series";
import { formatClockTime, formatDateTime, formatDayLabel, formatPower } from "@/lib/format";
import type { PowerPoint } from "@/lib/types";

interface PowerHistoryChartProps {
  points: PowerPoint[];
  range: HistoryRange;
}

export function PowerHistoryChart({ points, range }: PowerHistoryChartProps) {
  const data = useMemo(() => toTimeSeries(points, range), [points, range]);
  const tickFormatter = range === "24h" ? formatClockTime : formatDayLabel;

  // On 7d/30d the solar series is an hourly AVERAGE, which understates a solar
  // peak badly — measured on live data, buckets understated their own peak by
  // 39-67%, so a real 47.7 kW peak drew as 18.1 kW. The same site at the same
  // moment therefore showed different numbers depending on which range tab was
  // selected, with nothing on screen saying why.
  //
  // The peak line restores the missing information and the caption names what
  // each line is. 24h needs neither: every point there is a single 5-minute
  // reading, already its own peak.
  const hourly = range !== "24h";

  return (
    <>
      {hourly && (
        <p className="mb-1 text-[11px] text-muted-foreground">
          Hourly buckets — <span className="font-medium">peak</span> is the highest reading in each hour,{" "}
          <span className="font-medium">average</span> the mean across it.
        </p>
      )}
      <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
        {/* A real time scale, so a gap in the data occupies its true width on
            the axis instead of being collapsed to one category slot. */}
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
          labelFormatter={(v) => formatDateTime(v as number)}
          formatter={(value, name) => [formatPower(Number(value)), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* connectNulls stays off (the default): the null rows toTimeSeries
            inserts are what make an outage read as a break in the line. */}
        {/* Peak first so the filled average draws OVER it: the average is
            always <= the peak, so the result reads as a solid band up to the
            typical output with the peak outlined above it. */}
        {hourly && (
          <Area
            type="monotone"
            dataKey="peak_w"
            name="Solar peak"
            stroke="var(--color-solar)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            fill="none"
            isAnimationActive={false}
          />
        )}
        <Area
          type="monotone"
          dataKey="power_w"
          name={hourly ? "Solar average" : "Solar"}
          stroke="var(--color-solar)"
          fill="url(#solarFill)"
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Area type="monotone" dataKey="load_w" name="Load" stroke="var(--color-load)" fill="url(#loadFill)" strokeWidth={1.5} isAnimationActive={false} />
      </AreaChart>
      </ResponsiveContainer>
    </>
  );
}
