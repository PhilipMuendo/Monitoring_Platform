"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";

// A coupe built by extruding a side profile, rather than stacking rounded
// boxes.
//
// The box-stack version read as a shopping trolley: two grey capsules and
// four dark discs, with no bonnet line, no windscreen rake and no wheel
// arches. Silhouette is the only thing that survives at this scale — the
// car occupies roughly 40px — so the profile below is the whole design.
// A generous bevel does the rounding, which is why the extrusion doesn't
// look like a flat slab from the 3/4 camera.
//
// Authored in unit-length space (X from -0.5 rear to +0.5 nose) and scaled
// by `length`, so the proportions stay fixed wherever it's placed.

const BODY_PROFILE: [number, number][] = [
  [-0.5, 0.105], // rear valance
  [-0.5, 0.235],
  [-0.44, 0.275], // boot lip
  [-0.3, 0.295],
  [-0.17, 0.375], // rear screen base
  [-0.05, 0.412], // roof
  [0.09, 0.408],
  [0.2, 0.352], // windscreen top
  [0.33, 0.238], // cowl
  [0.42, 0.203], // bonnet
  [0.49, 0.171], // nose
  [0.5, 0.12],
  [0.5, 0.085],
  [0.34, 0.072], // sill, front
  [-0.32, 0.072], // sill, rear
];

// The greenhouse, inset slightly so it reads as glazing set into the body
// rather than painted onto it.
const GLASS_PROFILE: [number, number][] = [
  [-0.28, 0.3],
  [-0.16, 0.362],
  [-0.05, 0.396],
  [0.08, 0.392],
  [0.18, 0.342],
  [0.24, 0.298],
];

function extrudeProfile(points: [number, number][], depth: number, bevel: number) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  // Extrude builds along +Z from the shape plane; centre it on the origin.
  geometry.translate(0, 0, -(depth / 2 + bevel));
  geometry.computeVertexNormals();
  return geometry;
}

function Wheel({ position, radius }: { position: [number, number, number]; radius: number }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, 0.075, 20]} />
        <meshStandardMaterial color={STUDIO.carWheel} roughness={0.75} metalness={0.1} />
      </mesh>
      {/* rim face, offset to the outboard side */}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.012, 16]} />
        <meshStandardMaterial color={STUDIO.metal} roughness={0.35} metalness={0.6} />
      </mesh>
    </group>
  );
}

export function Car({
  position,
  length = 1.55,
  rotation = 0,
}: {
  position: [number, number, number];
  length?: number;
  rotation?: number;
}) {
  const width = 0.68;
  const bevel = 0.055;

  const bodyGeometry = useMemo(() => extrudeProfile(BODY_PROFILE, width - bevel * 2, bevel), [width, bevel]);
  // The greenhouse is extruded slightly WIDER than the body, so it breaks
  // the surface instead of being sealed inside it. Narrower (the obvious
  // choice) left the glass completely enclosed by the bodywork and the car
  // rendered as a featureless white blob with wheels.
  const glassGeometry = useMemo(() => extrudeProfile(GLASS_PROFILE, width - bevel * 2 + 0.014, 0.012), [width, bevel]);

  // Both geometries are built here and passed via the `geometry` prop, which
  // puts them outside r3f's automatic disposal. Freed explicitly so flipping
  // the 2D/3D toggle doesn't leak a pair of extruded meshes each time.
  useEffect(
    () => () => {
      bodyGeometry.dispose();
      glassGeometry.dispose();
    },
    [bodyGeometry, glassGeometry],
  );

  const wheelRadius = 0.108;
  const wheelZ = width / 2 - 0.03;

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={length}>
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={STUDIO.carBody}
          roughness={0.22}
          metalness={0.15}
          clearcoat={0.85}
          clearcoatRoughness={0.15}
        />
      </mesh>

      <mesh geometry={glassGeometry}>
        <meshPhysicalMaterial color={STUDIO.carGlass} roughness={0.1} metalness={0.35} clearcoat={0.9} />
      </mesh>

      {/* Headlight and tail-light slivers. Two small dark marks are enough
          to give the nose and tail a read at this size. */}
      <mesh position={[0.485, 0.152, 0.19]}>
        <boxGeometry args={[0.03, 0.028, 0.13]} />
        <meshStandardMaterial color={STUDIO.linen} roughness={0.2} metalness={0.3} emissive={STUDIO.linen} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0.485, 0.152, -0.19]}>
        <boxGeometry args={[0.03, 0.028, 0.13]} />
        <meshStandardMaterial color={STUDIO.linen} roughness={0.2} metalness={0.3} emissive={STUDIO.linen} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[-0.498, 0.245, 0]}>
        <boxGeometry args={[0.02, 0.022, 0.44]} />
        <meshStandardMaterial color={STUDIO.carTrim} roughness={0.4} />
      </mesh>

      <Wheel position={[0.3, wheelRadius, wheelZ]} radius={wheelRadius} />
      <Wheel position={[0.3, wheelRadius, -wheelZ]} radius={wheelRadius} />
      <Wheel position={[-0.3, wheelRadius, wheelZ]} radius={wheelRadius} />
      <Wheel position={[-0.3, wheelRadius, -wheelZ]} radius={wheelRadius} />
    </group>
  );
}
