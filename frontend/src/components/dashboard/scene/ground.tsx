"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";

// An invisible floor that only shows the shadow the scene casts onto it
// (THREE.ShadowMaterial), so the house is grounded without a visible slab.
//
// Deliberately faint. This carries the *direction* of the key light; the
// actual sense of objects resting on the floor comes from the drei
// <ContactShadows> pass in fleet-3d-power-flow.tsx, which derives each
// object's real silhouette instead of smearing one soft ellipse under it.
export function ShadowFloor({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <shadowMaterial transparent opacity={opacity} />
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

  // Built here rather than by r3f, so r3f will not free it — and the whole
  // Canvas unmounts on every 2D/3D toggle.
  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;

  return (
    <mesh position={[0, 3, -14]} renderOrder={-1}>
      <planeGeometry args={[60, 34]} />
      <meshBasicMaterial map={texture} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
