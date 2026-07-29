"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";

// Set back behind the house (negative Z) as well as to the right, so the
// tower never crosses in front of the sectioned rooms.
export const PYLON_POSITION: [number, number, number] = [2.9, 0, -1.35];
export const PYLON_ANCHOR: [number, number, number] = [PYLON_POSITION[0], 2.05, PYLON_POSITION[2]];

const HEIGHT = 2.3;
const BASE_HALF = 0.34; // half-width of the footprint
const TOP_HALF = 0.1; // half-width where the mast meets the crossarms
const BAYS = 5; // X-braced segments up the mast

// A lattice transmission tower.
//
// The previous version was a tapered cylinder with one crossarm, which
// reads as a telegraph pole rather than "the grid" — the reference render
// uses an unmistakable braced steel tower and leans on that silhouette to
// carry the meaning without a label. Built from thin instanced-ish
// cylinders rather than a GLB: the whole tower is ~40 segments, cheaper to
// draw than it would be to download.
function strut(
  from: [number, number, number],
  to: [number, number, number],
): { position: [number, number, number]; quaternion: THREE.Quaternion; length: number } {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  // Cylinders are built along +Y, so rotate that axis onto the strut.
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  return { position: [mid.x, mid.y, mid.z], quaternion, length };
}

export function GridPylon() {
  const { legs, braces } = useMemo(() => {
    // Four legs tapering from BASE_HALF to TOP_HALF.
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const at = (cx: number, cz: number, t: number): [number, number, number] => {
      const half = BASE_HALF + (TOP_HALF - BASE_HALF) * t;
      return [cx * half, t * HEIGHT, cz * half];
    };

    const legStruts = corners.map(([cx, cz]) => strut(at(cx, cz, 0), at(cx, cz, 1)));

    // X-bracing on each of the four faces, bay by bay.
    const braceStruts: ReturnType<typeof strut>[] = [];
    for (let bay = 0; bay < BAYS; bay++) {
      const t0 = bay / BAYS;
      const t1 = (bay + 1) / BAYS;
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f];
        const [bx, bz] = corners[(f + 1) % 4];
        braceStruts.push(strut(at(ax, az, t0), at(bx, bz, t1)));
        braceStruts.push(strut(at(bx, bz, t0), at(ax, az, t1)));
      }
      // horizontal ring at the top of each bay
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f];
        const [bx, bz] = corners[(f + 1) % 4];
        braceStruts.push(strut(at(ax, az, t1), at(bx, bz, t1)));
      }
    }

    return { legs: legStruts, braces: braceStruts };
  }, []);

  return (
    <group position={PYLON_POSITION}>
      {legs.map((s, i) => (
        <mesh key={`leg-${i}`} position={s.position} quaternion={s.quaternion} castShadow>
          <cylinderGeometry args={[0.018, 0.018, s.length, 6]} />
          <meshStandardMaterial color={STUDIO.metal} roughness={0.45} metalness={0.35} />
        </mesh>
      ))}
      {braces.map((s, i) => (
        <mesh key={`brace-${i}`} position={s.position} quaternion={s.quaternion}>
          <cylinderGeometry args={[0.009, 0.009, s.length, 5]} />
          <meshStandardMaterial color={STUDIO.metalDark} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}

      {/* Two crossarms with insulator strings hanging off them. */}
      {[
        { y: HEIGHT - 0.12, span: 1.0 },
        { y: HEIGHT - 0.5, span: 0.78 },
      ].map(({ y, span }) => (
        <group key={y} position={[0, y, 0]}>
          <mesh castShadow>
            <boxGeometry args={[span, 0.035, 0.05]} />
            <meshStandardMaterial color={STUDIO.metal} roughness={0.45} metalness={0.35} />
          </mesh>
          {/* diagonal stays back to the mast */}
          {[-1, 1].map((s) => {
            const st = strut([(s * span) / 2, 0, 0], [s * TOP_HALF * 0.6, 0.16, 0]);
            return (
              <mesh key={s} position={st.position} quaternion={st.quaternion}>
                <cylinderGeometry args={[0.008, 0.008, st.length, 5]} />
                <meshStandardMaterial color={STUDIO.metalDark} roughness={0.5} metalness={0.3} />
              </mesh>
            );
          })}
          {[-span / 2 + 0.05, 0, span / 2 - 0.05].map((x) => (
            <group key={x} position={[x, -0.02, 0]}>
              <mesh position={[0, -0.06, 0]}>
                <cylinderGeometry args={[0.016, 0.016, 0.1, 8]} />
                <meshStandardMaterial color={STUDIO.trim} roughness={0.35} metalness={0.15} />
              </mesh>
              <mesh position={[0, -0.13, 0]}>
                <sphereGeometry args={[0.022, 8, 6]} />
                <meshStandardMaterial color={STUDIO.trim} roughness={0.35} metalness={0.15} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
