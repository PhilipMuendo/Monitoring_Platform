"use client";

import { motion, useAnimationFrame, useMotionValue } from "framer-motion";
import { useMemo, useRef } from "react";

import { quadraticPath, quadraticPoint, type Point } from "@/lib/bezier";

interface PowerFlowEdgeProps {
  from: Point;
  to: Point;
  control: Point;
  active: boolean;
  /** true = flow visually travels from `to` toward `from` (e.g. grid export, battery discharge). */
  reverse: boolean;
  /** loops per second along the path; scales with the edge's power magnitude. */
  speed: number;
  particleCount: number;
  strokeWidth: number;
  colorVar: string;
}

export function PowerFlowEdge({
  from,
  to,
  control,
  active,
  reverse,
  speed,
  particleCount,
  strokeWidth,
  colorVar,
}: PowerFlowEdgeProps) {
  const pathD = useMemo(() => quadraticPath(from, control, to), [from, control, to]);
  const start = reverse ? to : from;
  const end = reverse ? from : to;

  return (
    <g>
      <path
        d={pathD}
        fill="none"
        stroke={colorVar}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{ opacity: active ? 0.28 : 0.08, transition: "opacity 0.6s ease" }}
      />
      {active &&
        Array.from({ length: particleCount }).map((_, i) => (
          <FlowParticle key={i} p0={start} p1={control} p2={end} phase={i / particleCount} speed={speed} colorVar={colorVar} />
        ))}
    </g>
  );
}

function FlowParticle({
  p0,
  p1,
  p2,
  phase,
  speed,
  colorVar,
}: {
  p0: Point;
  p1: Point;
  p2: Point;
  phase: number;
  speed: number;
  colorVar: string;
}) {
  const cx = useMotionValue(p0.x);
  const cy = useMotionValue(p0.y);
  const start = useRef<number | null>(null);

  useAnimationFrame((time) => {
    if (start.current === null) start.current = time;
    const elapsedSec = (time - start.current) / 1000;
    const t = (phase + elapsedSec * speed) % 1;
    const pt = quadraticPoint(p0, p1, p2, t);
    cx.set(pt.x);
    cy.set(pt.y);
  });

  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={3.2}
      style={{ fill: colorVar, filter: `drop-shadow(0 0 4px ${colorVar})` }}
    />
  );
}
