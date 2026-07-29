"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";

// An invisible floor that only shows the shadow the scene casts onto it
// (THREE.ShadowMaterial), so the house is grounded without a visible slab.
export function ShadowFloor({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <shadowMaterial transparent opacity={opacity} />
    </mesh>
  );
}

/**
 * A soft radial contact shadow painted straight onto the floor under a
 * given footprint.
 *
 * The directional light's cast shadow alone was long, hard-edged and dark
 * — the carport threw a grey trapezoid across the lower-right quadrant that
 * competed with the building for attention. Real architectural renders sell
 * the grounding with a tight, soft blob directly beneath the mass and keep
 * the cast shadow faint. This is that blob: a canvas-generated radial
 * gradient, which costs one texture and no extra shadow-map passes.
 */
export function ContactShadow({
  position,
  width,
  depth,
  opacity = 0.3,
}: {
  position: [number, number, number];
  width: number;
  depth: number;
  opacity?: number;
}) {
  const texture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.85)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.42)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  if (!texture) return null;

  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * A large vertical gradient plane behind the scene.
 *
 * The flat single-colour clear colour left the render feeling like a
 * screenshot on a swatch. The reference sits the building against a soft
 * blue-grey gradient that darkens toward the top, which is what gives it
 * depth without adding any geometry.
 */
export function GradientBackdrop() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, STUDIO.backdropTop);
    gradient.addColorStop(0.55, STUDIO.background);
    gradient.addColorStop(1, STUDIO.backdropBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  if (!texture) return null;

  return (
    <mesh position={[0, 3, -14]} renderOrder={-1}>
      <planeGeometry args={[60, 34]} />
      <meshBasicMaterial map={texture} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
