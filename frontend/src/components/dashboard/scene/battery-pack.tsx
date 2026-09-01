"use client";

import { RoundedBox } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";
import { HOUSE_OFFSET_X } from "@/lib/scene-layout";

// Moved out of the undercroft to stand in front of the house, on the
// paved apron that used to serve as the carport approach (compound.tsx's
// APRON spans x [-3.4, -1.5], z [-0.8, 2.6] before HOUSE_OFFSET_X — this
// sits well inside it). Kept at the same local x = -2.0 as before so it
// stays clear of the glazed wing's wall for the same reason it always
// was; only z moved, from 0.72 (tucked under the building) out to 2.0
// (out on the apron, clearly in front). Since it's no longer under the
// building's own cantilever it now carries its own shade canopy — see
// BatteryCanopy below — rather than relying on the undercroft's cover.
//
// + HOUSE_OFFSET_X (see lib/scene-layout.ts): the house and its paving
// (compound.tsx) both shift by this same amount, and the battery has to
// move with them to stay standing on the apron rather than being left
// behind on bare lawn.
export const BATTERY_POSITION: [number, number, number] = [-2.0 + HOUSE_OFFSET_X, 0, 2.0];

// ---------------------------------------------------------------------------
// A stacked modular home battery, in the shape the market has settled on: a
// grey floor plinth, a column of identical slim modules, and a control head on
// top. Modelled on the Dyness Stack-series form factor — deliberately
// UNBRANDED, no logo or wordmark on any face, because this scene stands in for
// whichever hardware a site actually has and putting a real manufacturer's
// marks on it would be both wrong for most sites and a trademark exposure we
// have no reason to invite — the same reasoning that picked a concept car over
// a production one back when this scene had a car in it. The silhouette is
// what carries the meaning.
//
// It replaces a single monolithic cabinet. The stack reads as a battery at a
// glance in a way the plain box did not: the repeated horizontal seams are the
// whole visual signature of this class of product, and they also give the eye
// a sense of scale that an untextured white slab in an untextured white scene
// could not.

const MODULE_COUNT = 10;
const MODULE_W = 0.46;
const MODULE_D = 0.4;
const MODULE_H = 0.076;
/**
 * Recessed shadow groove between modules.
 *
 * Tuned against the screen, not the reference photo. Projected through this
 * camera, 1 world unit of Y is 0.941 units of screen height, so at the
 * dashboard's typical zoom (~98 px/unit) a groove of 0.014 lands at 1.3 px —
 * thin enough that antialiasing washes it to nothing and the stack greys out
 * into the plain box it replaced. 0.020 gives ~1.8 px on the dashboard and
 * ~2.6 px on the wall, which survives. The pitch is unchanged, so the module
 * face gave up the height the groove gained and the stack is the same
 * overall size.
 */
const MODULE_GAP = 0.02;
const MODULE_PITCH = MODULE_H + MODULE_GAP;

const PLINTH_H = 0.1;
const PLINTH_W = 0.5;
const PLINTH_D = 0.44;

const HEAD_H = 0.115;

const STACK_BOTTOM = PLINTH_H;
const STACK_TOP = STACK_BOTTOM + (MODULE_COUNT - 1) * MODULE_PITCH + MODULE_H;
const HEAD_Y = STACK_TOP + MODULE_GAP + HEAD_H / 2;

// Total height is ~1.175.

// ---------------------------------------------------------------------------
// Shade canopy. Freestanding now that the stack has moved out from under the
// building's own cover — four slender posts and a flat roof, distinct from
// both the house (which is solid-walled) and the undercroft it replaces (which
// was a recess IN the building), so the battery reads as its own small
// structure rather than an appendage of either.
//
// Sized off the plinth's own footprint (the widest part of the stack)
// plus a fixed margin, rather than a hand-guessed constant, so it keeps
// covering the battery if PLINTH_W/PLINTH_D ever change. Clearance above
// the stack (POST_H vs. the ~1.175 total stack height computed below) is
// generous on purpose: a canopy that just grazes the control head reads
// as a lid, not a roof.
const CANOPY_MARGIN = 0.32;
const CANOPY_W = PLINTH_W + CANOPY_MARGIN * 2;
const CANOPY_D = PLINTH_D + CANOPY_MARGIN * 2;
const POST_H = 1.55;
const ROOF_T = 0.05;

/** Where the battery conduit leaves — at the control head, as it does in reality. */
export const BATTERY_ANCHOR: [number, number, number] = [BATTERY_POSITION[0], 1.12, BATTERY_POSITION[2]];

interface BatteryPackProps {
  accentColor: string;
  /** 0-100, or null when this installation does not report a charge level. */
  soc: number | null;
}

export function BatteryPack({ accentColor, soc }: BatteryPackProps) {
  // Null SOC draws the empty track and NO fill at all — not a fill of zero.
  // Per-site scenes make this reachable: a site whose inverter reports no
  // charge level would otherwise render a flat-empty battery, which reads as
  // "this battery is dead" rather than "we were not told". Same absent-is-not-
  // zero rule the flow legs follow.
  const known = soc != null && Number.isFinite(soc);
  const pct = known ? Math.min(100, Math.max(0, soc)) / 100 : 0;

  const trackH = STACK_TOP - STACK_BOTTOM - 0.04;
  const trackY = (STACK_BOTTOM + STACK_TOP) / 2;
  const fillHeight = Math.max(0.02, pct * trackH);

  // One instanced draw call for all ten modules instead of ten meshes with ten
  // geometries. The same reasoning as grid-pylon.tsx: it is barely measurable
  // on a desktop GPU and it matters on the Smart TV browser that runs the wall
  // display. Plain boxes rather than RoundedBox — instancing needs one shared
  // geometry, and at this size a module is ~8px tall on screen, so a bevel
  // radius that reads on the house shell is comfortably sub-pixel here.
  const moduleMatrices = useMemo(
    () =>
      Array.from({ length: MODULE_COUNT }, (_, i) =>
        new THREE.Matrix4().setPosition(0, STACK_BOTTOM + MODULE_H / 2 + i * MODULE_PITCH, 0),
      ),
    [],
  );

  const modulesRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = modulesRef.current;
    if (!mesh) return;
    moduleMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    // Instanced bounds are those of a single unit module otherwise, so the
    // whole stack can be frustum-culled while still on screen.
    mesh.computeBoundingSphere();
  }, [moduleMatrices]);

  return (
    <group position={BATTERY_POSITION}>
      {/* Shade canopy. Posts at the four corners of the footprint, a flat
          roof slab on top — deliberately the plainest possible shelter so it
          reads as "cover for the equipment" and never competes with the
          house's own roofline for attention. */}
      {[
        [-CANOPY_W / 2, -CANOPY_D / 2],
        [CANOPY_W / 2, -CANOPY_D / 2],
        [-CANOPY_W / 2, CANOPY_D / 2],
        [CANOPY_W / 2, CANOPY_D / 2],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, POST_H / 2, z]} castShadow>
          <boxGeometry args={[0.045, POST_H, 0.045]} />
          <meshStandardMaterial color={STUDIO.metalDark} roughness={0.55} metalness={0.25} />
        </mesh>
      ))}
      <RoundedBox
        args={[CANOPY_W + 0.1, ROOF_T, CANOPY_D + 0.1]}
        radius={0.015}
        smoothness={3}
        position={[0, POST_H + ROOF_T / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.wallSide} roughness={0.7} metalness={0.02} />
      </RoundedBox>

      {/* Floor plinth. The one grey element — every stack of this type sits on
          a darker base, and it also stops the white column reading as if it
          were floating on the white paving. */}
      <RoundedBox
        args={[PLINTH_W, PLINTH_H, PLINTH_D]}
        radius={0.012}
        smoothness={3}
        position={[0, PLINTH_H / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.6} metalness={0.2} />
      </RoundedBox>

      {/* Dark spine behind the modules, inset 0.025 on every side. This is what
          the gaps between modules actually show: without it each groove is a
          hole straight through to the wall behind, which at this scale reads as
          a stack of floating slabs rather than a cabinet. */}
      {/* metalDark, not the lighter cabinetTrim: only a ~2 px sliver of this
          is ever visible, and at that width it has to read as a shadow line
          rather than as a slightly different white. */}
      <mesh position={[0, (STACK_BOTTOM + STACK_TOP) / 2, 0]}>
        <boxGeometry args={[MODULE_W - 0.05, STACK_TOP - STACK_BOTTOM, MODULE_D - 0.05]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.75} />
      </mesh>

      <instancedMesh
        ref={modulesRef}
        args={[undefined, undefined, MODULE_COUNT]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[MODULE_W, MODULE_H, MODULE_D]} />
        <meshStandardMaterial color={STUDIO.cabinet} roughness={0.5} metalness={0.12} />
      </instancedMesh>

      {/* Control head. Slightly inset from the modules so the top of the stack
          steps in rather than ending flat, which is what the real units do and
          what stops the column reading as an extruded rectangle. */}
      <RoundedBox
        args={[MODULE_W - 0.03, HEAD_H, MODULE_D - 0.03]}
        radius={0.014}
        smoothness={3}
        position={[0, HEAD_Y, 0]}
        castShadow
      >
        <meshStandardMaterial color={STUDIO.cabinet} roughness={0.45} metalness={0.12} />
      </RoundedBox>
      {/* Its display, inset on the front face. */}
      <mesh position={[0.05, HEAD_Y, MODULE_D / 2 - 0.005]}>
        <boxGeometry args={[0.16, 0.05, 0.02]} />
        <meshStandardMaterial color={STUDIO.cabinetScreen} roughness={0.3} />
      </mesh>

      {/* State of charge, as a slim vertical strip up the left of the front
          face — the full height of the module column, so "how full is the
          battery" maps directly onto "how much of the stack is lit". Kept as
          one continuous bar rather than one lit pip per module: ten emissive
          pips would be ten more draw calls to express the same number at a
          coarser resolution. */}
      <mesh position={[-MODULE_W / 2 + 0.06, trackY, MODULE_D / 2 + 0.006]}>
        <boxGeometry args={[0.045, trackH, 0.012]} />
        <meshStandardMaterial color="#0c1016" roughness={0.5} />
      </mesh>
      {known && (
        <mesh position={[-MODULE_W / 2 + 0.06, trackY - trackH / 2 + fillHeight / 2, MODULE_D / 2 + 0.013]}>
          <boxGeometry args={[0.032, fillHeight, 0.012]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.9}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}
