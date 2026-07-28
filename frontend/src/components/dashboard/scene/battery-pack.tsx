"use client";

import { RoundedBox } from "@react-three/drei";

import { STUDIO } from "@/lib/power-flow-colors";

// Pushed well clear of the house (X = -2.9) so its callout never overlaps
// the building windows.
export const BATTERY_POSITION: [number, number, number] = [-2.9, 0, 0.3];
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
      {/* dark inset face */}
      <RoundedBox args={[0.36, 0.9, 0.03]} radius={0.02} smoothness={3} position={[0, 0.62, 0.18]}>
        <meshStandardMaterial color={STUDIO.cabinetScreen} roughness={0.4} />
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
