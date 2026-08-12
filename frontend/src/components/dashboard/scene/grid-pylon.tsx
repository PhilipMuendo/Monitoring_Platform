"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";

// Set back behind the house (negative Z) as well as to the right, so the
// tower never crosses in front of the sectioned rooms.
// Pulled in from x = 2.9. The free span from the crossarm to the building was
// the longest single stroke in the render and read as one huge line across the
// composition; shortening it also tightens the scene's overall width, which
// buys camera zoom for everything else.
export const PYLON_POSITION: [number, number, number] = [2.7, 0, -1.25];

// Raised from 2.3. The service drop attaches at the crossarm, and at the old
// height that attachment sat 0.6 BELOW the roof it feeds — so the span
// climbed from the tower up to the building, which is not how an overhead
// service behaves and was a large part of why the grid leg read as
// disconnected from the rest of the run. A transmission tower is taller than
// the house it serves; now it is, and the cable descends the whole way.
//
// The scene got no taller as a result: flattening the roof took the top of
// the building down from ~2.94 to ~2.73, so this reuses headroom that already
// existed rather than forcing the camera to zoom out. Keep those two facts
// together if either changes.
const HEIGHT = 3.0;
const BASE_HALF = 0.34; // half-width of the footprint
const TOP_HALF = 0.1; // half-width where the mast meets the crossarms
const BAYS = 5; // X-braced segments up the mast

const CROSSARMS = [
  { y: HEIGHT - 0.12, span: 1.0 },
  { y: HEIGHT - 0.5, span: 0.78 },
];

// Where the service drop actually leaves the tower: just under the top
// crossarm, at the insulators, rather than an arbitrary point up the mast.
// Derived from CROSSARMS so raising or lowering the tower can never leave the
// cable attached to thin air.
export const PYLON_ANCHOR: [number, number, number] = [PYLON_POSITION[0], CROSSARMS[0].y - 0.06, PYLON_POSITION[2]];

// A lattice transmission tower.
//
// The previous version was a tapered cylinder with one crossarm, which
// reads as a telegraph pole rather than "the grid" — the reference render
// uses an unmistakable braced steel tower and leans on that silhouette to
// carry the meaning without a label.
//
// Every repeated member is drawn with an InstancedMesh. Built as individual
// <mesh> elements this tower was ~82 draw calls with 82 separate geometries
// and materials, by far the heaviest object in the scene; it is now five.
// That mattered little on a desktop GPU and matters a great deal on the
// Smart TV browser that runs the wall display.
//
// Instancing needs one shared geometry, so every strut is a UNIT cylinder
// (height 1) scaled along Y to its own length by the instance matrix, rather
// than a per-strut cylinderGeometry sized at construction.

interface Strut {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
}

function strut(from: [number, number, number], to: [number, number, number]): Strut {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const position = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  // Cylinders are built along +Y, so rotate that axis onto the strut.
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  return { position, quaternion, length };
}

/** Composes strut transforms into instance matrices, scaling Y to length. */
function strutMatrices(struts: Strut[]): THREE.Matrix4[] {
  const scale = new THREE.Vector3();
  return struts.map((s) =>
    new THREE.Matrix4().compose(s.position, s.quaternion, scale.set(1, s.length, 1)),
  );
}

/** Writes matrices into an InstancedMesh once it exists. */
function useInstanceMatrices(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  matrices: THREE.Matrix4[],
) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    // Instanced bounding volumes are not derived from the matrices
    // automatically; without this the tower can be frustum-culled while
    // still on screen, because its bounds are those of a single unit strut.
    mesh.computeBoundingSphere();
  }, [ref, matrices]);
}

export function GridPylon() {
  const geometry = useMemo(() => {
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    // Four legs tapering from BASE_HALF to TOP_HALF.
    const at = (cx: number, cz: number, t: number): [number, number, number] => {
      const half = BASE_HALF + (TOP_HALF - BASE_HALF) * t;
      return [cx * half, t * HEIGHT, cz * half];
    };

    const legs = corners.map(([cx, cz]) => strut(at(cx, cz, 0), at(cx, cz, 1)));

    // X-bracing on each of the four faces, bay by bay.
    const braces: Strut[] = [];
    for (let bay = 0; bay < BAYS; bay++) {
      const t0 = bay / BAYS;
      const t1 = (bay + 1) / BAYS;
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f];
        const [bx, bz] = corners[(f + 1) % 4];
        braces.push(strut(at(ax, az, t0), at(bx, bz, t1)));
        braces.push(strut(at(bx, bz, t0), at(ax, az, t1)));
      }
      // horizontal ring at the top of each bay
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f];
        const [bx, bz] = corners[(f + 1) % 4];
        braces.push(strut(at(ax, az, t1), at(bx, bz, t1)));
      }
    }

    // Crossarm members, flattened out of their old nested groups into
    // pylon-local space so they can share the instanced meshes above.
    const arms: THREE.Matrix4[] = [];
    const insulatorPins: THREE.Matrix4[] = [];
    const insulatorBells: THREE.Matrix4[] = [];
    const identity = new THREE.Quaternion();
    const scratch = new THREE.Vector3();

    for (const { y, span } of CROSSARMS) {
      arms.push(
        new THREE.Matrix4().compose(
          scratch.set(0, y, 0).clone(),
          identity,
          new THREE.Vector3(span, 0.035, 0.05),
        ),
      );
      // diagonal stays back to the mast — same gauge as the bracing, so they
      // ride along in that instanced mesh rather than earning their own.
      for (const s of [-1, 1]) {
        braces.push(strut([(s * span) / 2, y, 0], [s * TOP_HALF * 0.6, y + 0.16, 0]));
      }
      for (const x of [-span / 2 + 0.05, 0, span / 2 - 0.05]) {
        insulatorPins.push(
          new THREE.Matrix4().compose(scratch.set(x, y - 0.08, 0).clone(), identity, new THREE.Vector3(1, 1, 1)),
        );
        insulatorBells.push(
          new THREE.Matrix4().compose(scratch.set(x, y - 0.15, 0).clone(), identity, new THREE.Vector3(1, 1, 1)),
        );
      }
    }

    return {
      legs: strutMatrices(legs),
      braces: strutMatrices(braces),
      arms,
      insulatorPins,
      insulatorBells,
    };
  }, []);

  const legsRef = useRef<THREE.InstancedMesh>(null);
  const bracesRef = useRef<THREE.InstancedMesh>(null);
  const armsRef = useRef<THREE.InstancedMesh>(null);
  const pinsRef = useRef<THREE.InstancedMesh>(null);
  const bellsRef = useRef<THREE.InstancedMesh>(null);

  useInstanceMatrices(legsRef, geometry.legs);
  useInstanceMatrices(bracesRef, geometry.braces);
  useInstanceMatrices(armsRef, geometry.arms);
  useInstanceMatrices(pinsRef, geometry.insulatorPins);
  useInstanceMatrices(bellsRef, geometry.insulatorBells);

  return (
    <group position={PYLON_POSITION}>
      <instancedMesh ref={legsRef} args={[undefined, undefined, geometry.legs.length]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 1, 6]} />
        <meshStandardMaterial color={STUDIO.metal} roughness={0.45} metalness={0.35} />
      </instancedMesh>

      {/* Braces lightened from metalDark to metal. Sixty dark struts made the
          tower the heaviest, highest-contrast object in an otherwise all-white
          render — it pulled the eye away from the building, which is the
          subject. Sosen's plant view draws its tower almost ghosted, letting
          the silhouette carry the meaning without competing. */}
      <instancedMesh ref={bracesRef} args={[undefined, undefined, geometry.braces.length]}>
        <cylinderGeometry args={[0.009, 0.009, 1, 5]} />
        <meshStandardMaterial color={STUDIO.metal} roughness={0.55} metalness={0.2} />
      </instancedMesh>

      <instancedMesh ref={armsRef} args={[undefined, undefined, geometry.arms.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={STUDIO.metal} roughness={0.45} metalness={0.35} />
      </instancedMesh>

      <instancedMesh ref={pinsRef} args={[undefined, undefined, geometry.insulatorPins.length]}>
        <cylinderGeometry args={[0.016, 0.016, 0.1, 8]} />
        <meshStandardMaterial color={STUDIO.trim} roughness={0.35} metalness={0.15} />
      </instancedMesh>

      <instancedMesh ref={bellsRef} args={[undefined, undefined, geometry.insulatorBells.length]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color={STUDIO.trim} roughness={0.35} metalness={0.15} />
      </instancedMesh>
    </group>
  );
}
