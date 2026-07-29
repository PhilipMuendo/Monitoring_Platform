"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export interface PowerFlowLabelContentProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  sublabel?: string;
  colorClass: string;
  bgClass: string;
  active: boolean;
  size?: number;
  /**
   * Draws the text stack on an opaque chip. Needed for the centre hub: its
   * label sits directly between the badge and the battery node, so the
   * battery flow edge runs straight through the text on its way up.
   */
  chip?: boolean;
}

// The actual icon-badge + label + value stack, shared verbatim between the
// 2D SVG diagram's foreignObject wrapper (PowerFlowNode) and the 3D
// scene's <Html> wrapper (PowerFlowLabel3D), so the two views can never
// drift apart visually.
export function PowerFlowLabelContent({
  icon: Icon,
  label,
  value,
  sublabel,
  colorClass,
  bgClass,
  active,
  size = 88,
  chip = false,
}: PowerFlowLabelContentProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-center">
      <motion.div
        className={cn("relative flex items-center justify-center rounded-full border", bgClass)}
        style={{ width: size * 0.6, height: size * 0.6 }}
        animate={active ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={{ duration: 2.4, repeat: active ? Infinity : 0, ease: "easeInOut" }}
      >
        {active && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-20", bgClass)} />}
        <Icon className={cn("size-5", colorClass)} strokeWidth={2} />
      </motion.div>
      {/* nowrap throughout: these sit in a fixed-size SVG foreignObject, so a
          wrapped sublabel ("discharging 347.5 kW") pushes a second line past
          the box and the SVG viewport slices it off mid-word. PowerFlowNode
          gives the box enough width for the longest label instead. */}
      <div className={cn("flex flex-col items-center", chip && "rounded-md bg-card px-2 py-0.5")}>
        <div className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={cn("whitespace-nowrap font-mono text-sm font-semibold tabular-nums", colorClass)}>{value}</div>
        {sublabel && <div className="whitespace-nowrap text-[10px] leading-tight text-muted-foreground">{sublabel}</div>}
      </div>
    </div>
  );
}
