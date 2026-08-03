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
  /** CSS var, e.g. "var(--color-solar)" — a soft glow cast behind the
   *  badge while this node is actively flowing power. One deliberate
   *  "warmth" touch on an otherwise restrained instrument panel: static
   *  light, not motion, so it reads as premium rather than distracting
   *  on a wall display running unattended for hours. */
  glowVar?: string;
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
  glowVar,
}: PowerFlowLabelContentProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
      <motion.div
        className={cn("relative flex items-center justify-center rounded-full border", bgClass)}
        style={{
          width: size * 0.56,
          height: size * 0.56,
          boxShadow: active && glowVar ? `0 0 22px -4px ${glowVar}` : undefined,
        }}
        animate={active ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 3, repeat: active ? Infinity : 0, ease: "easeInOut" }}
      >
        {active && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-10", bgClass)} />}
        <Icon className={cn("size-4.5", colorClass)} strokeWidth={1.75} />
      </motion.div>
      <div className="label-caps text-micro font-semibold text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-semibold tabular-nums", colorClass)}>{value}</div>
      {sublabel && <div className="whitespace-nowrap text-micro leading-tight text-muted-foreground">{sublabel}</div>}
    </div>
  );
}
