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
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-semibold tabular-nums", colorClass)}>{value}</div>
      {sublabel && <div className="text-[10px] leading-tight text-muted-foreground">{sublabel}</div>}
    </div>
  );
}
