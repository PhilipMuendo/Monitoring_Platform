"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

interface PowerFlowEdge3DProps {
  from: [number, number, number];
  to: [number, number, number];
  control: [number, number, number];
  active: boolean;
  /** true = particles visually travel from `to` toward `from`. */
  reverse: boolean;
  /** loops per second along the curve; scales with the edge's power magnitude. */
  speed: number;
  particleCount: number;
  color: string;
}

// The 3D equivalent of the 2D SVG flow edge: a faint static conduit plus a
// few glowing particles looping along a quadratic curve, animated via
// r3f's useFrame. Kept deliberately subtle (low line opacity, small
// additive-glow dots) so the flows read as clean neon paths rather than
// harsh solid lines. Direction/threshold semantics match the 2D view.
export function PowerFlowEdge3D({ from, to, control, active, reverse, speed, particleCount, color }: PowerFlowEdge3DProps) {
  const curve = useMemo(() => {
    const start = reverse ? to : from;
    const end = reverse ? from : to;
    return new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...start),
      new THREE.Vector3(...control),
      new THREE.Vector3(...end),
    );
  }, [from, to, control, reverse]);

  const lineObject = useMemo(() => {
    const points = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from),
      new THREE.Vector3(...control),
      new THREE.Vector3(...to),
    ).getPoints(28);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: active ? 0.16 : 0.06,
    });
    return new THREE.Line(geometry, material);
  }, [from, to, control, color, active]);

  return (
    <group>
      <primitive object={lineObject} />
      {active &&
        Array.from({ length: particleCount }).map((_, i) => (
          <FlowParticle key={i} curve={curve} phase={i / particleCount} speed={speed} color={color} />
        ))}
    </group>
  );
}

function FlowParticle({
  curve,
  phase,
  speed,
  color,
}: {
  curve: THREE.QuadraticBezierCurve3;
  phase: number;
  speed: number;
  color: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const t = (phase + elapsed.current * speed) % 1;
    const point = curve.getPoint(t);
    groupRef.current?.position.copy(point);
  });

  return (
    <group ref={groupRef}>
      {/* bright core */}
      <mesh>
        <sphereGeometry args={[0.038, 10, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* faint additive halo for a soft neon bloom without postprocessing */}
      <mesh>
        <sphereGeometry args={[0.085, 12, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
