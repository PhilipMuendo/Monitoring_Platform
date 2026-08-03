// A bespoke Recharts tooltip: the design system's own card treatment
// (hairline border, mono tabular values, a color dot per series) instead
// of Recharts' default white box patched with inline CSS-var styles.
// This is the "custom visual treatment, not a custom charting engine"
// distinction — Recharts still does the math, this owns how it looks.
interface ChartTooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  payload?: ChartTooltipPayloadEntry[];
  labelFormatter: (label: string) => string;
  valueFormatter: (value: number) => string;
}

export function ChartTooltip({ active, label, payload, labelFormatter, valueFormatter }: ChartTooltipProps) {
  if (!active || !payload?.length || label === undefined) return null;

  return (
    <div className="min-w-36 border border-border bg-popover px-3 py-2 shadow-lg shadow-black/20">
      <div className="label-caps mb-1.5 text-micro font-semibold text-muted-foreground">{labelFormatter(label)}</div>
      <div className="flex flex-col gap-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono font-semibold tabular-nums">{valueFormatter(Number(entry.value))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
