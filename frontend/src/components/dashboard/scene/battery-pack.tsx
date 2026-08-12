"use client";

import { RoundedBox } from "@react-three/drei";

import { STUDIO } from "@/lib/power-flow-colors";

// Pulled in from X = -2.9 to sit just off the house's front-left corner.
// The old position bought callout clearance at the cost of a wide empty
// band on the left of the frame, which forced the camera to zoom out and
// left the building small; callout collisions are handled in screen space
// now instead. Kept forward of the facade (Z = 1.05) rather than flat
// against the left wall, because from the front-right camera anything
// tucked beside the house is occluded by it.
// Sits inside the undercroft now, tucked against the main body's left wall
// (x = -1.7) and toward the open face so it stays visible from the camera.
// Wall-mounted or wall-adjacent battery storage under cover is where these
// actually live, and both reference renders place it exactly there rather
// than freestanding on open ground.
export const BATTERY_POSITION: [number, number, number] = [-1.92, 0, 0.72];
export const BATTERY_ANCHOR: [number, number, number] = [BATTERY_POSITION[0], 1.12, BATTERY_POSITION[2]];

interface BatteryPackProps {
  accentColor: string;
  soc: number; // 0-100
}

// A modern floor-standing home-battery cabinet with a slim vertical charge
// indicator whose lit height tracks state of charge.
export function BatteryPack({ accentColor, soc }: BatteryPackProps) {
  const pct = Math.min(100, Math.max(0, soc)) / 100;
  const barMax = 0.72;
  const fillHeight = Math.max(0.03, pct * barMax);

  return (
    <group position={BATTERY_POSITION}>
      <RoundedBox args={[0.52, 1.15, 0.36]} radius={0.06} smoothness={4} position={[0, 0.575, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={STUDIO.cabinet} roughness={0.5} metalness={0.15} />
      </RoundedBox>
      {/* Inset face. Kept light rather than near-black: at this scale a dark
          slab on a white cabinet reads as a hole punched in the scene, and
          from the front-right camera it was the only thing visible of the
          battery at all. */}
      <RoundedBox args={[0.36, 0.9, 0.03]} radius={0.02} smoothness={3} position={[0, 0.62, 0.18]}>
        <meshStandardMaterial color={STUDIO.cabinetTrim} roughness={0.55} />
      </RoundedBox>
      {/* charge indicator track */}
      <mesh position={[0, 0.62, 0.2]}>
        <boxGeometry args={[0.07, barMax + 0.05, 0.01]} />
        <meshStandardMaterial color="#0c1016" roughness={0.5} />
      </mesh>
      {/* charge fill (bottom-anchored) */}
      <mesh position={[0, 0.62 - barMax / 2 + fillHeight / 2, 0.21]}>
        <boxGeometry args={[0.055, fillHeight, 0.012]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}
