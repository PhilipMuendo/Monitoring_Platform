"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { STUDIO_INK } from "@/lib/power-flow-colors";

interface PowerFlowEdge3DProps {
  from: [number, number, number];
  to: [number, number, number];
  control: [number, number, number];
  active: boolean;
  /** true = chevrons visually travel from `to` toward `from`. */
  reverse: boolean;
  /** loops per second along the curve; scales with the edge's power magnitude. */
  speed: number;
  particleCount: number;
  color: string;
}

// A light-grey conduit with small chevron arrows travelling along it.
//
// This replaces glowing sphere particles. Two problems with those: at panel
// size a 0.038-radius additive sphere is a couple of pixels and reads as a
// compression artifact rather than a moving charge, and a dot carries no
// direction — the whole point of a power-flow diagram is showing which way
// the energy goes, and grid import vs. export is the one thing an operator
// most needs at a glance. A chevron states direction even in a still frame.
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

  // The conduit itself is a neutral tube, not an accent-coloured line. The
  // reference draws plain grey pipes and lets only the moving arrows carry
  // colour, which keeps four simultaneous flows from turning the render
  // into a tangle of coloured string.
  const tube = useMemo(() => {
    const path = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from),
      new THREE.Vector3(...control),
      new THREE.Vector3(...to),
    );
    // Radius 0.028, not 0.012. At the camera's zoom (~62 px per world unit)
    // the old tube came out under one pixel wide and simply vanished — the
    // conduits were invisible in the panel. Same reason the chevrons below
    // are sized in tenths of a unit rather than hundredths.
    return new THREE.TubeGeometry(path, 30, 0.028, 8, false);
  }, [from, control, to]);

  return (
    <group>
      <mesh geometry={tube}>
        <meshStandardMaterial
          color={STUDIO_INK.line}
          roughness={0.7}
          metalness={0.1}
          transparent
          opacity={active ? 0.55 : 0.25}
        />
      </mesh>
      {active &&
        Array.from({ length: particleCount }).map((_, i) => (
          <FlowChevron key={i} curve={curve} phase={i / particleCount} speed={speed} color={color} />
        ))}
    </group>
  );
}

// Chevron built once at module scope and shared by every arrow — a flat
// two-armed "V" lying in the XZ plane, pointing down +Z, which is the axis
// lookAt orients toward the direction of travel.
const CHEVRON_GEOMETRY = (() => {
  const shape = new THREE.Shape();
  const halfSpan = 0.14;
  const depth = 0.19;
  const thickness = 0.062;
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(0, depth);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(halfSpan - thickness, 0);
  shape.lineTo(0, depth - thickness * 1.4);
  shape.lineTo(-halfSpan + thickness, 0);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  // ShapeGeometry builds in XY; rotate so the arrow lies flat facing +Z.
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  return geometry;
})();

function FlowChevron({
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
  const meshRef = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    elapsed.current += delta;
    const t = (phase + elapsed.current * speed) % 1;

    const point = curve.getPoint(t);
    mesh.position.copy(point);

    // Orient along the curve tangent so the arrow always points the way the
    // power is flowing, including round the bends.
    const tangent = curve.getTangent(t);
    lookTarget.copy(point).add(tangent);
    mesh.lookAt(lookTarget);

    // Fade in and out at the ends so arrows don't pop into existence on top
    // of the node they're travelling toward.
    const fade = Math.min(1, Math.min(t, 1 - t) * 8);
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = fade;
  });

  return (
    <mesh ref={meshRef} geometry={CHEVRON_GEOMETRY}>
      <meshBasicMaterial color={color} transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
