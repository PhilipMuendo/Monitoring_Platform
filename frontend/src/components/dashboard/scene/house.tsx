"use client";

import { RoundedBox } from "@react-three/drei";

import { STUDIO } from "@/lib/power-flow-colors";

// A modern two-storey house built from rounded primitives (drei RoundedBox
// softens every edge so it no longer reads as a blocky prototype). Large
// tinted-glass window bands use MeshPhysicalMaterial transmission so they
// refract/reflect the studio environment. All dimensions are parametric.

const W = 2.5; // body width (X)
const GROUND_H = 1.3;
const UPPER_H = 1.25;
const GROUND_D = 2.05; // depth (Z)
const UPPER_D = 1.8; // upper storey set back at the rear
const WALL_TOP = GROUND_H + UPPER_H; // 2.55

const HALF_W = W / 2;
const GROUND_HALF_D = GROUND_D / 2;

// World-space anchors other scene pieces (flows / callouts) hook into.
export const HOUSE_HUB_ANCHOR: [number, number, number] = [HALF_W - 0.4, 0.92, GROUND_HALF_D + 0.08];
export const HOUSE_LOAD_ANCHOR: [number, number, number] = [-0.55, GROUND_H + UPPER_H * 0.5, GROUND_HALF_D + 0.05];
export const SOLAR_PANEL_ANCHOR: [number, number, number] = [0, WALL_TOP + 0.5, -0.1];

function GlassWindow({
  position,
  width,
  height,
  face = "front",
}: {
  position: [number, number, number];
  width: number;
  height: number;
  face?: "front" | "left";
}) {
  const rotY = face === "left" ? Math.PI / 2 : 0;
  const mullions = Math.max(1, Math.round(width / 0.55));
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* frame */}
      <RoundedBox args={[width + 0.1, height + 0.1, 0.06]} radius={0.02} smoothness={3} castShadow>
        <meshStandardMaterial color={STUDIO.frame} roughness={0.45} metalness={0.2} />
      </RoundedBox>
      {/* tinted glass pane */}
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[width, height, 0.03]} />
        <meshPhysicalMaterial
          color={STUDIO.glassTint}
          transmission={0.9}
          transparent
          opacity={0.85}
          roughness={0.1}
          metalness={0}
          ior={1.45}
          thickness={0.2}
          reflectivity={0.5}
        />
      </mesh>
      {/* vertical mullions for frame detailing */}
      {Array.from({ length: mullions - 1 }).map((_, i) => {
        const x = -width / 2 + (width / mullions) * (i + 1);
        return (
          <mesh key={i} position={[x, 0, 0.06]}>
            <boxGeometry args={[0.025, height, 0.02]} />
            <meshStandardMaterial color={STUDIO.frame} roughness={0.45} metalness={0.2} />
          </mesh>
        );
      })}
    </group>
  );
}

function SolarArray() {
  const rows = 3;
  const cols = 5;
  const pw = 0.4;
  const pd = 0.42;
  const gap = 0.04;
  const totalW = cols * pw + (cols - 1) * gap;
  const totalD = rows * pd + (rows - 1) * gap;
  return (
    <group>
      <RoundedBox args={[totalW + 0.14, 0.05, totalD + 0.14]} radius={0.02} smoothness={3} position={[0, 0, 0]} castShadow>
        <meshStandardMaterial color={STUDIO.panelFrame} roughness={0.4} metalness={0.5} />
      </RoundedBox>
      {Array.from({ length: cols }).map((_, c) =>
        Array.from({ length: rows }).map((_, r) => (
          <mesh
            key={`${c}-${r}`}
            castShadow
            position={[-totalW / 2 + pw / 2 + c * (pw + gap), 0.05, -totalD / 2 + pd / 2 + r * (pd + gap)]}
          >
            <boxGeometry args={[pw, 0.02, pd]} />
            <meshPhysicalMaterial color={STUDIO.panel} roughness={0.12} metalness={0.6} clearcoat={0.8} clearcoatRoughness={0.15} />
          </mesh>
        )),
      )}
    </group>
  );
}

export function House() {
  return (
    <group>
      {/* Ground storey */}
      <RoundedBox args={[W, GROUND_H, GROUND_D]} radius={0.05} smoothness={4} position={[0, GROUND_H / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={STUDIO.wall} roughness={0.8} metalness={0} />
      </RoundedBox>

      {/* Upper storey (set back at the rear, flush at the front) */}
      <RoundedBox
        args={[W, UPPER_H, UPPER_D]}
        radius={0.05}
        smoothness={4}
        position={[0, GROUND_H + UPPER_H / 2, (GROUND_D - UPPER_D) / 2]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.wallSide} roughness={0.8} metalness={0} />
      </RoundedBox>

      {/* Slim shadow-line reveal between storeys */}
      <mesh position={[0, GROUND_H, GROUND_HALF_D + 0.005]}>
        <boxGeometry args={[W + 0.02, 0.05, 0.02]} />
        <meshStandardMaterial color={STUDIO.trim} roughness={0.7} />
      </mesh>

      {/* Windows */}
      <GlassWindow position={[-0.35, 0.72, GROUND_HALF_D + 0.02]} width={1.5} height={0.86} />
      <GlassWindow position={[0, GROUND_H + UPPER_H * 0.52, GROUND_HALF_D + 0.02]} width={2.0} height={0.5} />
      <GlassWindow position={[-HALF_W - 0.02, 0.75, -0.1]} width={1.2} height={0.82} face="left" />

      {/* Mono-pitch roof carrying the solar array */}
      <group position={[0, WALL_TOP, (GROUND_D - UPPER_D) / 2]} rotation={[0.16, 0, 0]}>
        <RoundedBox args={[W + 0.26, 0.1, UPPER_D + 0.26]} radius={0.03} smoothness={3} position={[0, 0.05, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={STUDIO.roof} roughness={0.75} metalness={0.02} />
        </RoundedBox>
        <group position={[0, 0.12, 0.02]}>
          <SolarArray />
        </group>
      </group>

      {/* Wall-mounted inverter (the convergence hub) */}
      <RoundedBox args={[0.26, 0.36, 0.12]} radius={0.03} smoothness={3} position={HOUSE_HUB_ANCHOR} castShadow>
        <meshStandardMaterial color={STUDIO.cabinet} roughness={0.5} metalness={0.1} />
      </RoundedBox>
      <mesh position={[HOUSE_HUB_ANCHOR[0], HOUSE_HUB_ANCHOR[1], HOUSE_HUB_ANCHOR[2] + 0.04]}>
        <boxGeometry args={[0.15, 0.11, 0.03]} />
        <meshStandardMaterial color={STUDIO.cabinetScreen} emissive="#1d84f5" emissiveIntensity={0.3} roughness={0.3} />
      </mesh>
    </group>
  );
}
