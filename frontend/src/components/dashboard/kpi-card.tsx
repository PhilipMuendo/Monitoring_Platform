"use client";

import { useEffect, useRef, useState } from "react";

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
// the only thing meant to draw the eye. Tracking-tight on the number is a
// deliberate typographic choice (same move Tesla/Apple make on large
// numerals) — it reads as engineered, not just enlarged.
export function KpiCard({ icon: Icon, label, value, sublabel, colorClass = "text-foreground", accentClass = "bg-foreground/40" }: KpiCardProps) {
  const previousValue = useRef(value);
  const [justChanged, setJustChanged] = useState(false);

  useEffect(() => {
    if (previousValue.current !== value) {
      previousValue.current = value;
      setJustChanged(true);
      const id = setTimeout(() => setJustChanged(false), 900);
      return () => clearTimeout(id);
    }
  }, [value]);

  return (
    <div className="group relative flex flex-col gap-1 bg-card px-3 py-2.5 transition-colors duration-150 ease-[var(--ease-out-confident)] hover:bg-accent/40">
      <span className={cn("absolute inset-x-0 top-0 h-0.5 transition-opacity duration-150", accentClass, "opacity-70 group-hover:opacity-100")} />
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps truncate text-micro font-semibold text-muted-foreground">{label}</span>
        <Icon className={cn("size-3.5 shrink-0", colorClass)} strokeWidth={1.75} />
      </div>
      <div
        className={cn(
          "w-fit truncate rounded-xs font-mono text-xl leading-none font-semibold tracking-tight tabular-nums",
          colorClass,
          justChanged && "animate-value-flash",
        )}
      >
        {value}
      </div>
      {sublabel && <div className="truncate text-tiny text-muted-foreground">{sublabel}</div>}
    </div>
  );
}
