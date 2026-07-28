"use client";

import { RoundedBox } from "@react-three/drei";

import { STUDIO } from "@/lib/power-flow-colors";

// A simple original low-poly car built from rounded primitives so it reads
// as a smooth vehicle silhouette rather than a stack of boxes. Long axis
// along X for a clean 3/4 view from the front-right camera.
export function Car({ position }: { position: [number, number, number] }) {
  const wheels: [number, number, number][] = [
    [-0.44, 0.14, 0.25],
    [0.44, 0.14, 0.25],
    [-0.44, 0.14, -0.25],
    [0.44, 0.14, -0.25],
  ];

  return (
    <group position={position}>
      {/* lower body */}
      <RoundedBox args={[1.32, 0.3, 0.62]} radius={0.14} smoothness={4} position={[0, 0.28, 0]} castShadow>
        <meshPhysicalMaterial color={STUDIO.carBody} roughness={0.25} metalness={0.25} clearcoat={0.7} clearcoatRoughness={0.2} />
      </RoundedBox>
      {/* cabin */}
      <RoundedBox args={[0.66, 0.3, 0.54]} radius={0.14} smoothness={4} position={[-0.04, 0.5, 0]} castShadow>
        <meshPhysicalMaterial color={STUDIO.carBody} roughness={0.25} metalness={0.25} clearcoat={0.7} clearcoatRoughness={0.2} />
      </RoundedBox>
      {/* greenhouse glass */}
      <RoundedBox args={[0.52, 0.2, 0.56]} radius={0.08} smoothness={3} position={[-0.04, 0.52, 0]}>
        <meshPhysicalMaterial color={STUDIO.carGlass} transmission={0.6} transparent opacity={0.9} roughness={0.1} metalness={0.2} />
      </RoundedBox>
      {/* wheels */}
      {wheels.map((p, i) => (
        <mesh key={i} position={p} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.14, 0.14, 0.12, 18]} />
          <meshStandardMaterial color={STUDIO.carWheel} roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}
