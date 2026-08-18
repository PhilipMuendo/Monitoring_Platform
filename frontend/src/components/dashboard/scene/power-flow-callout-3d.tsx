"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { StudioInk } from "@/lib/power-flow-colors";

interface PowerFlowCallout3DProps {
  anchor: [number, number, number];
  label: string;
  value: string;
  sublabel?: string;
  /**
   * Text and leader colours for the phase the scene is currently in, from
   * SCENE_LIGHTING. Passed rather than imported because the canvas background
   * follows the clock in Kenya: near-black labels are correct at midday and
   * illegible over the night sky.
   */
  ink: StudioInk;
  /**
   * Accent for this quantity, from SCENE_LIGHTING's `accents` — not a theme
   * class. These labels sit on the canvas, whose background follows the clock
   * in Kenya rather than the app theme, so a `text-solar` class would pick
   * whichever variant the *page* is in and be wrong roughly half the time.
   *
   * Used only for the small marker dot. See the note on the value colour.
   */
  color: string;
  /** Minimum leader length in px, so a high anchor still gets a visible stem. */
  minLineLength?: number;
  /**
   * Horizontal nudge in screen px, applied to the label block only — the
   * leader line stays anchored to the component.
   *
   * Needed because pinning every label to one baseline row puts four
   * variable-width text blocks on the same line, and anchors that are well
   * separated in world space can still project close enough together for
   * "charging 33.1 kW" to run into the next readout. A px nudge is stable
   * across camera zoom because both it and the label live in screen space.
   */
  offsetX?: number;
}

/**
 * Screen-space Y (px from the top of the canvas) that every callout's text
 * block is pinned to. Chosen to clear the fleet-count overlay in the corner
 * while leaving the tallest anchor — the roof-mounted solar array — a
 * visible leader.
 */
const BASELINE_Y = 64;

// Minimalist data callout: a thin dashed vertical leader connecting a text
// block to a component in the scene.
//
// The leader length is computed per frame from the anchor's projected screen
// position rather than hardcoded, so all four labels sit on one horizontal
// band no matter how the camera reframes. Previously each callout carried a
// fixed pixel length, which put the four labels at four different heights
// and made the eye hunt for them; the reference render aligns them into a
// single row across the top and is markedly easier to read for it.
export function PowerFlowCallout3D({
  anchor,
  label,
  value,
  sublabel,
  color,
  ink,
  minLineLength = 18,
  offsetX = 0,
}: PowerFlowCallout3DProps) {
  const lineRef = useRef<HTMLDivElement>(null);
  const { camera, size } = useThree();
  const anchorVec = useMemo(() => new THREE.Vector3(...anchor), [anchor]);
  const projected = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const el = lineRef.current;
    if (!el) return;

    // Project to NDC, then to pixels from the top of the canvas.
    projected.copy(anchorVec).project(camera);
    const anchorY = ((1 - projected.y) / 2) * size.height;

    const length = Math.max(minLineLength, anchorY - BASELINE_Y);
    el.style.height = `${length}px`;
  });

  return (
    <Html position={anchor} transform={false} pointerEvents="none">
      <div
        className="flex flex-col items-center"
        style={{
          transform: `translate(calc(-50% + ${offsetX}px), -100%)`,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        <div className="flex flex-col items-center leading-tight">
          <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: ink.muted }}>
            {/* The accent survives as a 4px dot rather than tinting the whole
                readout. Four saturated values at once made the overlay look
                like a chart legend; the reference spends its colour budget on
                a single glyph and renders every number in near-black. */}
            <span aria-hidden className="inline-block size-1 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums" style={{ color: ink.strong }}>
            {value}
          </span>
          {sublabel && (
            <span className="text-[9px]" style={{ color: ink.muted }}>
              {sublabel}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center pt-1.5">
          <div ref={lineRef} className="w-0 border-l border-dashed" style={{ height: minLineLength, borderColor: ink.line }} />
        </div>
      </div>
    </Html>
  );
}
