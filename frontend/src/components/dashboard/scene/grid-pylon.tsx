"use client";

import { STUDIO } from "@/lib/power-flow-colors";

export const PYLON_POSITION: [number, number, number] = [3.5, 0, -0.4];
export const PYLON_ANCHOR: [number, number, number] = [PYLON_POSITION[0], 1.75, PYLON_POSITION[2]];

// A clean modern monopole pylon on the right of the scene: a tapered mast
// with a single crossarm and small insulator caps. Light metal so it
// stays airy against the bright studio background.
export function GridPylon() {
  return (
    <group position={PYLON_POSITION}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.09, 1.8, 10]} />
        <meshStandardMaterial color={STUDIO.metal} roughness={0.35} metalness={0.5} />
      </mesh>
      {/* crossarm */}
      <mesh position={[0, 1.62, 0]} castShadow>
        <boxGeometry args={[0.9, 0.06, 0.08]} />
        <meshStandardMaterial color={STUDIO.metal} roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[0.06, 0.2, 0.06]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.4} metalness={0.5} />
      </mesh>
      {[-0.38, 0, 0.38].map((x) => (
        <mesh key={x} position={[x, 1.68, 0]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          <meshStandardMaterial color={STUDIO.trim} roughness={0.3} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}
