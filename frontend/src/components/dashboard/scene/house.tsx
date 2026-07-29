"use client";

import { RoundedBox } from "@react-three/drei";

import { Bedroom, LivingRoom } from "@/components/dashboard/scene/interior";
import { STUDIO } from "@/lib/power-flow-colors";

// A two-storey house rendered as a doll's-house section: the front wall is
// removed from the right wing so you see into a furnished living room and
// bedroom, while the left wing keeps a glazed facade.
//
// Why sectioned: a sealed white box reads as abstract massing, and the
// reference render this scene is modelled on gets most of its warmth from
// showing the interior. Cutting the building open is the single highest-
// impact change available here — everything else (glazing, shadows,
// materials) is refinement on top of it.
//
// Why the RIGHT wing: the camera sits front-right at [7.6, 5.2, 8.2]. With
// the section on the left it was the most distant, most foreshortened part
// of the building and the rooms barely read at panel size. On the right the
// open face is both nearest the camera and closest to square-on to it.
//
// All dimensions are parametric and the world-space anchors below are what
// the flow edges and callouts hook into.

const W = 2.5; // total body width (X)
const GROUND_H = 1.3;
const UPPER_H = 1.25;
const GROUND_D = 2.05; // depth (Z)
const UPPER_D = 1.8; // upper storey set back at the rear on the closed wing
const WALL_TOP = GROUND_H + UPPER_H; // 2.55

const HALF_W = W / 2;
const GROUND_HALF_D = GROUND_D / 2;

// The section plane. Right of this X the front wall is omitted; left of it
// the facade is intact and glazed.
const CUT_X = -0.05;
const CUT_W = HALF_W - CUT_X; // 1.3
const CUT_CENTRE = (CUT_X + HALF_W) / 2; // 0.6

const SLAB_T = 0.06; // floor slab thickness, visible as a white edge at the cut
const SHELL_T = 0.07; // wall thickness

const GLAZED_W = CUT_X + HALF_W; // 1.2
const GLAZED_CENTRE = (-HALF_W + CUT_X) / 2; // -0.65

// World-space anchors other scene pieces (flows / callouts) hook into.
//
// The hub is the wall-mounted inverter on the closed wing's facade — the
// same place the reference render puts it, on the outside wall beside the
// meter. Keeping it on a solid wall means the four flow conduits converge
// somewhere physical instead of floating inside a sectioned room.
export const HOUSE_HUB_ANCHOR: [number, number, number] = [GLAZED_CENTRE - 0.07, 0.92, GROUND_HALF_D + 0.07];
// Load anchors on the living-room television, which lights up when the
// fleet is drawing load and goes dark when it isn't. Pointing the Load
// callout at something that visibly changes state beats pointing it at
// inert furniture: the screen answers "is anything running?" before anyone
// reads the number. World-space equivalent of the TV's placement inside the
// scaled LivingRoom group.
export const HOUSE_LOAD_ANCHOR: [number, number, number] = [0.06, 0.75, -0.1];
export const SOLAR_PANEL_ANCHOR: [number, number, number] = [0, WALL_TOP + 0.55, -0.1];

// Recessed window: a warm backing panel set into the wall, glass in front
// of it, and a frame ring flush with the facade.
//
// The previous version sat *proud* of the wall as a dark box with a
// transmission pane and nothing behind it. With no interior to transmit,
// the panes rendered near-black and read as solar panels bolted to the
// facade — actively misleading in a diagram whose job is showing where
// power comes from. The backing panel fixes that: the glass now has a lit
// room behind it, which is what makes architectural glazing read as glass.
function RecessedWindow({
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
  const mullions = Math.max(1, Math.round(width / 0.5));
  const depth = 0.1;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* reveal: the shadowed sides of the opening */}
      <mesh position={[0, 0, -depth / 2]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={STUDIO.interiorWall} roughness={0.9} />
      </mesh>

      {/* room behind the glass, faintly self-lit so the pane never goes black */}
      <mesh position={[0, 0, -depth + 0.006]}>
        <planeGeometry args={[width - 0.01, height - 0.01]} />
        <meshStandardMaterial
          color={STUDIO.interiorWall}
          roughness={1}
          emissive={STUDIO.linen}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* glass, inset from the facade rather than proud of it */}
      <mesh position={[0, 0, -0.025]}>
        <boxGeometry args={[width - 0.02, height - 0.02, 0.012]} />
        <meshPhysicalMaterial
          color={STUDIO.glassTint}
          transmission={0.95}
          transparent
          opacity={0.5}
          roughness={0.05}
          metalness={0}
          ior={1.45}
          thickness={0.04}
          reflectivity={0.65}
        />
      </mesh>

      {/* slim frame ring, flush with the wall face */}
      {[
        { args: [width + 0.03, 0.022, 0.04] as const, pos: [0, height / 2, 0] as const },
        { args: [width + 0.03, 0.022, 0.04] as const, pos: [0, -height / 2, 0] as const },
        { args: [0.022, height + 0.03, 0.04] as const, pos: [-width / 2, 0, 0] as const },
        { args: [0.022, height + 0.03, 0.04] as const, pos: [width / 2, 0, 0] as const },
      ].map((bar, i) => (
        <mesh key={i} position={bar.pos}>
          <boxGeometry args={bar.args} />
          <meshStandardMaterial color={STUDIO.frame} roughness={0.5} metalness={0.25} />
        </mesh>
      ))}

      {/* vertical mullions */}
      {Array.from({ length: mullions - 1 }).map((_, i) => {
        const x = -width / 2 + (width / mullions) * (i + 1);
        return (
          <mesh key={i} position={[x, 0, -0.012]}>
            <boxGeometry args={[0.014, height, 0.025]} />
            <meshStandardMaterial color={STUDIO.frame} roughness={0.5} metalness={0.25} />
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

// The open wing: back wall, right end wall, partition at the cut, and floor
// slabs whose exposed front edges give the section its white banding.
function CutawayShell() {
  const floors = [0, GROUND_H];

  return (
    <group>
      {/* back wall */}
      <mesh position={[CUT_CENTRE, WALL_TOP / 2, -GROUND_HALF_D + SHELL_T / 2]} receiveShadow>
        <boxGeometry args={[CUT_W, WALL_TOP, SHELL_T]} />
        <meshStandardMaterial color={STUDIO.interiorWall} roughness={0.95} />
      </mesh>

      {/* No right end wall, by design. The camera sits at 45° between the
          +X and +Z faces, so leaving the end wall in place put a blank white
          slab across half the opening and the rooms were only glimpsed
          edge-on. Removing both faces makes this a corner section — which is
          what the reference render does — and the interior reads properly. */}

      {/* partition against the glazed wing */}
      <mesh position={[CUT_X + SHELL_T / 2, WALL_TOP / 2, 0]} receiveShadow>
        <boxGeometry args={[SHELL_T, WALL_TOP, GROUND_D]} />
        <meshStandardMaterial color={STUDIO.interiorWall} roughness={0.95} />
      </mesh>

      {/* floor slabs — the exposed edges are what make a section read as a
          section rather than as a missing wall */}
      {floors.map((y) => (
        <group key={y}>
          <mesh position={[CUT_CENTRE, y + SLAB_T / 2, 0]} receiveShadow castShadow>
            <boxGeometry args={[CUT_W, SLAB_T, GROUND_D]} />
            <meshStandardMaterial color={STUDIO.slabEdge} roughness={0.85} />
          </mesh>
          <mesh position={[CUT_CENTRE, y + SLAB_T + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[CUT_W - SHELL_T, GROUND_D - SHELL_T]} />
            <meshStandardMaterial color={STUDIO.floor} roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* ceiling slab closing the top of the upper room */}
      <mesh position={[CUT_CENTRE, WALL_TOP + SLAB_T / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[CUT_W, SLAB_T, GROUND_D]} />
        <meshStandardMaterial color={STUDIO.slabEdge} roughness={0.85} />
      </mesh>

      {/* Fill light for the sectioned rooms. The studio key rakes in from
          the upper-left and never reaches inside, so without this the
          furniture silhouettes sink into shade — the exact failure that
          makes a cutaway look like a dark hole instead of a room. Placed out
          at the open corner, on the camera side, so it lights what's
          actually visible. */}
      <pointLight position={[HALF_W + 0.8, GROUND_H * 0.7, GROUND_HALF_D + 0.8]} intensity={1.05} distance={4.2} decay={2} color="#fff4e6" />
      <pointLight position={[HALF_W + 0.8, GROUND_H + UPPER_H * 0.66, GROUND_HALF_D + 0.8]} intensity={1} distance={4.2} decay={2} color="#fff4e6" />
    </group>
  );
}

export function House({ loadActive = false }: { loadActive?: boolean }) {
  return (
    <group>
      {/* --- Sectioned right wing --- */}
      <CutawayShell />
      {/* Furniture scaled up ~12%: at true architectural proportion a sofa
          is a handful of pixels here and the rooms read as empty shells.
          Slightly oversized furnishings are a standard doll's-house-render
          cheat and the reference does the same. */}
      <group position={[CUT_CENTRE, SLAB_T, 0.05]} scale={1.12}>
        <LivingRoom loadActive={loadActive} />
      </group>
      <group position={[CUT_CENTRE, GROUND_H + SLAB_T, 0.05]} scale={1.12}>
        <Bedroom />
      </group>

      {/* --- Closed, glazed left wing --- */}
      <RoundedBox
        args={[GLAZED_W, GROUND_H, GROUND_D]}
        radius={0.04}
        smoothness={4}
        position={[GLAZED_CENTRE, GROUND_H / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.wall} roughness={0.8} metalness={0} />
      </RoundedBox>
      <RoundedBox
        args={[GLAZED_W, UPPER_H, UPPER_D]}
        radius={0.04}
        smoothness={4}
        position={[GLAZED_CENTRE, GROUND_H + UPPER_H / 2, (GROUND_D - UPPER_D) / 2]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.wallSide} roughness={0.8} metalness={0} />
      </RoundedBox>

      {/* Slim shadow-line reveal between storeys on the closed wing */}
      <mesh position={[GLAZED_CENTRE, GROUND_H, GROUND_HALF_D + 0.005]}>
        <boxGeometry args={[GLAZED_W + 0.02, 0.04, 0.02]} />
        <meshStandardMaterial color={STUDIO.trim} roughness={0.7} />
      </mesh>

      {/* Glazing on the closed wing only — the open wing shows real rooms */}
      <RecessedWindow position={[GLAZED_CENTRE + 0.1, 0.74, GROUND_HALF_D]} width={0.78} height={0.8} />
      <RecessedWindow
        position={[GLAZED_CENTRE, GROUND_H + UPPER_H * 0.52, GROUND_HALF_D - (GROUND_D - UPPER_D)]}
        width={0.9}
        height={0.52}
      />
      <RecessedWindow position={[-HALF_W, 0.76, -0.3]} width={1.0} height={0.78} face="left" />

      {/* Mono-pitch roof carrying the solar array, spanning both wings */}
      <group position={[0, WALL_TOP + SLAB_T, (GROUND_D - UPPER_D) / 2]} rotation={[0.16, 0, 0]}>
        <RoundedBox args={[W + 0.26, 0.1, UPPER_D + 0.3]} radius={0.03} smoothness={3} position={[0, 0.05, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={STUDIO.roof} roughness={0.75} metalness={0.02} />
        </RoundedBox>
        <group position={[0, 0.12, 0.02]}>
          <SolarArray />
        </group>
      </group>

      {/* Wall-mounted inverter (the convergence hub) plus the utility meter
          beside it, both on the closed wing's facade like the reference. */}
      <RoundedBox args={[0.22, 0.32, 0.1]} radius={0.03} smoothness={3} position={HOUSE_HUB_ANCHOR} castShadow>
        <meshStandardMaterial color={STUDIO.cabinet} roughness={0.5} metalness={0.1} />
      </RoundedBox>
      <mesh position={[HOUSE_HUB_ANCHOR[0], HOUSE_HUB_ANCHOR[1], HOUSE_HUB_ANCHOR[2] + 0.04]}>
        <boxGeometry args={[0.13, 0.09, 0.03]} />
        <meshStandardMaterial color={STUDIO.cabinetScreen} emissive="#1d84f5" emissiveIntensity={0.3} roughness={0.3} />
      </mesh>
      <RoundedBox
        args={[0.14, 0.18, 0.08]}
        radius={0.02}
        smoothness={3}
        position={[HOUSE_HUB_ANCHOR[0] - 0.26, HOUSE_HUB_ANCHOR[1] + 0.28, HOUSE_HUB_ANCHOR[2] - 0.01]}
        castShadow
      >
        <meshStandardMaterial color={STUDIO.sofaAccent} roughness={0.6} metalness={0.05} />
      </RoundedBox>
    </group>
  );
}
