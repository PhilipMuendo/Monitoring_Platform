import { cn } from "@/lib/utils";

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  sublabel?: string;
  colorClass?: string;
  accentClass?: string;
}

// A single readout cell in the fleet telemetry strip — deliberately not a
// soft "card with icon blob": a thin colored rule on the top edge carries
// the semantic accent, the icon stays a muted mark, and the mono value is
// the only thing meant to draw the eye.
export function KpiCard({ icon: Icon, label, value, sublabel, colorClass = "text-foreground", accentClass = "bg-foreground/40" }: KpiCardProps) {
  return (
    <div className="relative flex flex-col gap-1 bg-card px-3 py-2.5">
      <span className={cn("absolute inset-x-0 top-0 h-0.5", accentClass)} />
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps truncate text-[10px] font-semibold text-muted-foreground">{label}</span>
        <Icon className={cn("size-3.5 shrink-0", colorClass)} strokeWidth={2} />
      </div>
      <div className={cn("truncate font-mono text-xl leading-none font-semibold tabular-nums", colorClass)}>{value}</div>
      {sublabel && <div className="truncate text-[11px] text-muted-foreground">{sublabel}</div>}
    </div>
  );
}
