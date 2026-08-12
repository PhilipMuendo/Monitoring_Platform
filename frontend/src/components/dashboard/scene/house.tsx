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

// Massing. Width was 2.5 against a 2.55 wall height — a 0.98:1 cube, which
// reads as a block rather than as a building. The reference this scene is
// modelled on (and Sosen's own plant view) are emphatically horizontal: long,
// low, layered. 3.4 puts this at 1.33:1, and because the extra width all goes
// to the glazed wing (see CUT_X) the sectioned rooms keep their proportions.
const W = 3.4; // total body width (X)
const GROUND_H = 1.3;
const UPPER_H = 1.25;
const GROUND_D = 2.05; // depth (Z)
const UPPER_D = 1.8; // upper storey set back at the rear on the closed wing
const WALL_TOP = GROUND_H + UPPER_H; // 2.55

const HALF_W = W / 2;
const GROUND_HALF_D = GROUND_D / 2;

// The section plane. Right of this X the front wall is omitted; left of it
// the facade is intact and glazed.
//
// Moved with W (was -0.05 when W was 2.5) specifically so CUT_W stays at 1.3.
// The sectioned rooms were sized for legibility at panel scale and the
// furniture inside them is authored to that width, so the whole of the extra
// body width is given to the glazed wing (1.2 -> 2.1). That is also what
// makes the massing read horizontally: one long solid-and-glazed volume
// running into a shorter open section, rather than a wider box.
const CUT_X = 0.4;
const CUT_W = HALF_W - CUT_X; // 1.3
const CUT_CENTRE = (CUT_X + HALF_W) / 2; // 1.05

const SLAB_T = 0.06; // floor slab thickness, visible as a white edge at the cut
const SHELL_T = 0.07; // wall thickness

const GLAZED_W = CUT_X + HALF_W; // 2.1
const GLAZED_CENTRE = (-HALF_W + CUT_X) / 2; // -0.65

// Undercroft: an open ground-level bay on the left end with the upper storey
// oversailing it, and the car parked underneath.
//
// This is the gesture that most separates the reference renders from ours.
// It earns its place three times over:
//   1. The deep horizontal shadow under a cantilever is the strongest "real
//      building" cue in both reference images — untextured white massing has
//      nothing else to describe its own depth.
//   2. It costs no scene width. The car previously sat outside on open ground
//      and was, with the pylon, one of the two things stretching the camera
//      fit and shrinking the house. Inside the footprint it is free.
//   3. It takes the body from 3.4 to 4.9 wide overall against a 2.55 wall
//      height — 1.92:1, which is finally in the same territory as Sosen's
//      long, low massing rather than a block.
const UNDERCROFT_W = 1.5;
const UNDERCROFT_CENTRE = -HALF_W - UNDERCROFT_W / 2; // -2.45
const UNDERCROFT_OUTER = -HALF_W - UNDERCROFT_W; // -3.2
// Matches the upper storey's depth and offset so the oversailing volume reads
// as one continuous mass with the storey it grows out of.
const UNDERCROFT_D = UPPER_D;
const UNDERCROFT_Z = (GROUND_D - UPPER_D) / 2;

/** Where the car parks — inside the bay, under the overhang. */
export const CARPORT_POSITION: [number, number, number] = [UNDERCROFT_CENTRE, 0, UNDERCROFT_Z + 0.12];

// How the furnished rooms are seated inside the cutaway wing. Declared here
// rather than inline at the call site because HOUSE_LOAD_ANCHOR below is
// derived from them — see the comment there.
const ROOM_SCALE = 1.12;
const ROOM_Z = 0.05;
/**
 * Television position in LivingRoom's local space. MUST match the
 * <Television> placement in interior.tsx — HOUSE_LOAD_ANCHOR below is derived
 * from it, and the Load callout and conduit both terminate on that anchor.
 */
const TV_LOCAL: [number, number, number] = [-0.46, 0.62, 0.28];

// Roof. FLAT, bearing directly on the wall head.
//
// It used to be a slab pitched 0.16 rad about its own centre, which is what
// made it look like it was sliding off the building. Rotating a slab about
// its centre lifts one edge and drops the other: the back edge ended up 0.23
// clear of the wall it is supposed to sit on, and the front edge drove 0.11
// BELOW the wall head, cutting into the parapet. So the roof simultaneously
// floated at the back and sank at the front — read as bending.
//
// A pitched plane on a flat wall head always leaves that wedge unless the
// walls are gabled to match, and nothing here gables them. Flat is also what
// the undercroft's own cap already was (the two never agreed), what the
// reference render shows, and what gives the grid conduit a real surface to
// lie along rather than a slope.
const ROOF_T = 0.1;
const ROOF_Z = 0.04;
// Depth chosen so the back edge lands flush with the cutaway's back wall
// (z = -1.025) and the front carries a modest 0.08 eaves overhang.
const ROOF_D = 2.13;
/** Top face of the roof slab — the surface the grid conduit runs along. */
export const ROOF_TOP_Y = WALL_TOP + ROOF_T;
/** Front edge of the eaves. A conduit dropping to the facade must clear this in Z. */
export const ROOF_FRONT_Z = ROOF_Z + ROOF_D / 2;
/** Local Z of the array inside the roof group, leaving a clear deck strip at the front. */
const ARRAY_Z = -0.06;
/** Top surface of the panels. */
const ARRAY_TOP_Y = ROOF_TOP_Y + 0.08;

// Front glazing, right-aligned at the partition line.
//
// Both windows stop short of the left corner, which is the point: it leaves a
// blank bay of solid wall for the service cluster — inverter, meter and the
// two conduit drops. Previously the ground-floor window ran to x = -1.15 and
// the inverter was mounted at x = -0.72, i.e. ON the glass, which forced every
// conduit reaching it to cross glazing. Real services go on blank wall beside
// the incoming supply, and routing them cleanly needs somewhere to route them.
const WIN_RIGHT = 0.35;
const GROUND_WIN_W = 1.25;
const UPPER_WIN_W = 1.35;
const GROUND_WIN_X = WIN_RIGHT - GROUND_WIN_W / 2;
const UPPER_WIN_X = WIN_RIGHT - UPPER_WIN_W / 2;
/** Everything left of the leftmost glazing edge is solid wall. */
const SERVICE_BAY_RIGHT = Math.min(GROUND_WIN_X - GROUND_WIN_W / 2, UPPER_WIN_X - UPPER_WIN_W / 2);

// World-space anchors other scene pieces (flows / callouts) hook into.
//
// The hub is the wall-mounted inverter, now in the blank service bay at the
// left of the closed wing rather than in the middle of the glazing. Keeping
// it on solid wall means the four conduits converge somewhere physical, and
// — the reason it moved — means they can each reach it without crossing a
// window or each other. See the routing block in fleet-3d-power-flow.tsx.
const HUB_X = -1.3;
const HUB_HALF_W = 0.11;
const HUB_HALF_H = 0.16;
export const HOUSE_HUB_ANCHOR: [number, number, number] = [HUB_X, 0.92, GROUND_HALF_D + 0.07];
/** Faces of the inverter box. Conduits terminate on these, not on its centre. */
export const HUB_LEFT_X = HUB_X - HUB_HALF_W;
export const HUB_RIGHT_X = HUB_X + HUB_HALF_W;
export const HUB_TOP_Y = HOUSE_HUB_ANCHOR[1] + HUB_HALF_H;
/**
 * X of the solar drop — straight down onto the inverter's top face, and the
 * leftmost of the two facade drops.
 */
export const SOLAR_DROP_X = HUB_X - 0.06;
/**
 * X of the grid drop — right of the inverter, and still clear of the glazing
 * edge at SERVICE_BAY_RIGHT. This is what puts solar on the left and grid on
 * the right with nothing crossing in between.
 */
export const GRID_DROP_X = SERVICE_BAY_RIGHT - 0.08;
// Load anchors on the living-room television, which lights up when the
// fleet is drawing load and goes dark when it isn't. Pointing the Load
// callout at something that visibly changes state beats pointing it at
// inert furniture: the screen answers "is anything running?" before anyone
// reads the number.
//
// COMPUTED from the room transform rather than written out, because it is
// the world-space image of a point that lives inside a translated + scaled
// group. It was previously the literal [0.06, 0.75, -0.1], which was correct
// only while CUT_CENTRE happened to be 0.6 — widening the house moved the
// television and would have left the Load callout and its conduit pointing at
// empty air a whole room away, with nothing to catch it.
export const HOUSE_LOAD_ANCHOR: [number, number, number] = [
  CUT_CENTRE + TV_LOCAL[0] * ROOM_SCALE,
  SLAB_T + TV_LOCAL[1] * ROOM_SCALE,
  ROOM_Z + TV_LOCAL[2] * ROOM_SCALE,
];
// On the array, at its LEFT end and directly above the inverter, so the run
// off the panels is a single forward step over the eaves and then one straight
// vertical drop — no jog across the facade to find the hub. Sitting 0.04 proud
// of the panel tops keeps the conduit clear of the modules it leaves.
export const SOLAR_PANEL_ANCHOR: [number, number, number] = [SOLAR_DROP_X, ARRAY_TOP_Y + 0.04, 0.3];
// HOUSE_GRID_SERVICE_ANCHOR (a stub on the right-hand gable) has been removed.
// The grid leg used to stop there rather than reach the inverter, on the
// grounds that a full cross-facade run collided with the load conduit. That
// avoided the collision by making the diagram untrue — the utility feed
// visibly connected to nothing. Both runs are now routed as orthogonal
// conduit at different heights and in different planes off the wall, so they
// pass each other cleanly and the grid terminates where it physically must:
// the inverter. See the routing block in fleet-3d-power-flow.tsx.

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
  lit = true,
}: {
  position: [number, number, number];
  width: number;
  height: number;
  face?: "front" | "left";
  /** Dims the room behind the glass when the fleet is drawing no load. */
  lit?: boolean;
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

      {/* Room behind the glass, faintly self-lit so the pane never goes black.
          Dimmed rather than switched off when there is no load: taking the
          emissive to zero brings back the original bug this panel was added
          to fix, where unlit panes rendered near-black and read as solar
          panels bolted to the facade. 0.08 is visibly "lights are off" while
          still letting the glazing read as glass. */}
      <mesh position={[0, 0, -depth + 0.006]}>
        <planeGeometry args={[width - 0.01, height - 0.01]} />
        <meshStandardMaterial
          color={STUDIO.interiorWall}
          roughness={1}
          emissive={STUDIO.linen}
          emissiveIntensity={lit ? 0.3 : 0.08}
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

      {/* slim frame ring, flush with the wall face.
          Tuples are typed mutable rather than `as const`: RoundedBox's args
          prop is a mutable tuple, so a readonly one is rejected. */}
      {(
        [
          { args: [width + 0.03, 0.022, 0.04], pos: [0, height / 2, 0] },
          { args: [width + 0.03, 0.022, 0.04], pos: [0, -height / 2, 0] },
          { args: [0.022, height + 0.03, 0.04], pos: [-width / 2, 0, 0] },
          { args: [0.022, height + 0.03, 0.04], pos: [width / 2, 0, 0] },
        ] satisfies { args: [number, number, number]; pos: [number, number, number] }[]
      ).map((bar, i) => (
        <RoundedBox key={i} args={bar.args} radius={0.006} smoothness={2} position={bar.pos}>
          <meshStandardMaterial color={STUDIO.frame} roughness={0.5} metalness={0.25} />
        </RoundedBox>
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
  // 7 across, not 5. The roof widened with the body (W + 0.26 = 3.66) and a
  // 2.3-wide array left bare deck either side, which reads as an undersized
  // system on an oversized roof — the opposite of what a solar dashboard
  // should imply. 7 columns spans 3.04 and keeps a sensible margin.
  const cols = 7;
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
      {/* The array is the only dark mass against an all-white building, so
          its edges are the highest-contrast lines in the whole render and
          the first place a hard box edge gives the game away. Bevelled so
          each panel picks up a bright rim off the environment, which is
          exactly what reads in the reference. */}
      {Array.from({ length: cols }).map((_, c) =>
        Array.from({ length: rows }).map((_, r) => (
          <RoundedBox
            key={`${c}-${r}`}
            args={[pw, 0.02, pd]}
            radius={0.006}
            smoothness={2}
            castShadow
            position={[-totalW / 2 + pw / 2 + c * (pw + gap), 0.05, -totalD / 2 + pd / 2 + r * (pd + gap)]}
          >
            <meshPhysicalMaterial color={STUDIO.panel} roughness={0.12} metalness={0.6} clearcoat={0.8} clearcoatRoughness={0.15} />
          </RoundedBox>
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
      {/* back wall
          Rounded rather than a raw box, like every other masonry surface in
          here now. A real wall arris catches a thin highlight along its
          length; a geometrically perfect 90-degree edge cannot, and reads as
          a flat shape with a drawn outline. The radius is deliberately tiny
          (~1 cm at this scale) — the point is a 1-2 px specular line, not a
          visibly bullnosed corner. */}
      <RoundedBox
        args={[CUT_W, WALL_TOP, SHELL_T]}
        radius={0.012}
        smoothness={2}
        position={[CUT_CENTRE, WALL_TOP / 2, -GROUND_HALF_D + SHELL_T / 2]}
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.interiorWall} roughness={0.95} />
      </RoundedBox>

      {/* No right end wall, by design. The camera sits at 45° between the
          +X and +Z faces, so leaving the end wall in place put a blank white
          slab across half the opening and the rooms were only glimpsed
          edge-on. Removing both faces makes this a corner section — which is
          what the reference render does — and the interior reads properly. */}

      {/* partition against the glazed wing */}
      <RoundedBox
        args={[SHELL_T, WALL_TOP, GROUND_D]}
        radius={0.012}
        smoothness={2}
        position={[CUT_X + SHELL_T / 2, WALL_TOP / 2, 0]}
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.interiorWall} roughness={0.95} />
      </RoundedBox>

      {/* floor slabs — the exposed edges are what make a section read as a
          section rather than as a missing wall */}
      {floors.map((y) => (
        <group key={y}>
          <RoundedBox
            args={[CUT_W, SLAB_T, GROUND_D]}
            radius={0.01}
            smoothness={2}
            position={[CUT_CENTRE, y + SLAB_T / 2, 0]}
            receiveShadow
            castShadow
          >
            <meshStandardMaterial color={STUDIO.slabEdge} roughness={0.85} />
          </RoundedBox>
          <mesh position={[CUT_CENTRE, y + SLAB_T + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[CUT_W - SHELL_T, GROUND_D - SHELL_T]} />
            <meshStandardMaterial color={STUDIO.floor} roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Ceiling slab closing the top of the upper room. Tucked just BELOW
          WALL_TOP rather than sitting on it, so the flat roof can bear on a
          single clean plane across the whole building. Above it, the slab's
          underside and the roof's underside were coplanar over the cut wing
          and z-fought. */}
      <RoundedBox
        args={[CUT_W, SLAB_T, GROUND_D]}
        radius={0.01}
        smoothness={2}
        position={[CUT_CENTRE, WALL_TOP - SLAB_T / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.slabEdge} roughness={0.85} />
      </RoundedBox>

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

/**
 * The oversailing upper volume, its two supporting columns and the flat cap
 * above — the ground level between them is deliberately left empty, which is
 * the whole point: that void is where the car goes and where the shadow band
 * comes from.
 */
function Undercroft() {
  const columnZ = [UNDERCROFT_Z - UNDERCROFT_D / 2 + 0.13, UNDERCROFT_Z + UNDERCROFT_D / 2 - 0.13];

  return (
    <group>
      {/* Oversailing storey. Same material as the closed wing so the two read
          as one building rather than an extension bolted on. */}
      <RoundedBox
        args={[UNDERCROFT_W, UPPER_H, UNDERCROFT_D]}
        radius={0.04}
        smoothness={4}
        position={[UNDERCROFT_CENTRE, GROUND_H + UPPER_H / 2, UNDERCROFT_Z]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={STUDIO.wallSide}
          roughness={0.82}
          metalness={0}
          sheen={0.45}
          sheenRoughness={0.75}
          sheenColor="#ffffff"
        />
      </RoundedBox>

      {/* Two slim columns at the outer corners. Enough to make the overhang
          structurally legible without filling the void — a bay with no
          support at all reads as a floating slab, and one with a solid end
          wall stops being an undercroft and becomes a garage. */}
      {columnZ.map((z) => (
        <RoundedBox
          key={z}
          args={[0.11, GROUND_H, 0.11]}
          radius={0.02}
          smoothness={2}
          position={[UNDERCROFT_OUTER + 0.1, GROUND_H / 2, z]}
          castShadow
        >
          <meshStandardMaterial color={STUDIO.wall} roughness={0.8} />
        </RoundedBox>
      ))}

      {/* Flat cap, stepping down from the main mono-pitch roof. Both
          references are stepped compositions with the array on one portion
          only, rather than a single roof plane over everything. */}
      <RoundedBox
        args={[UNDERCROFT_W + 0.12, 0.09, UNDERCROFT_D + 0.12]}
        radius={0.025}
        smoothness={2}
        position={[UNDERCROFT_CENTRE, WALL_TOP + 0.045, UNDERCROFT_Z]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={STUDIO.roof} roughness={0.75} metalness={0.02} />
      </RoundedBox>

      {/* Without this the bay does its job too well: the soffit blocks the key
          light and both the car and the battery cabinet collapse into
          silhouettes. Placed out at the open face, on the camera side, so it
          lifts what is actually visible without washing out the shadow that
          makes the overhang read. */}
      <pointLight
        position={[UNDERCROFT_CENTRE, GROUND_H * 0.72, UNDERCROFT_Z + UNDERCROFT_D / 2 + 0.9]}
        intensity={0.62}
        distance={3.2}
        decay={2}
        color="#fffaf2"
      />
    </group>
  );
}

export function House({ loadActive = false }: { loadActive?: boolean }) {
  return (
    <group>
      {/* --- Open bay at the left end, upper storey oversailing --- */}
      <Undercroft />

      {/* --- Sectioned right wing --- */}
      <CutawayShell />
      {/* Furniture scaled up ~12%: at true architectural proportion a sofa
          is a handful of pixels here and the rooms read as empty shells.
          Slightly oversized furnishings are a standard doll's-house-render
          cheat and the reference does the same. */}
      <group position={[CUT_CENTRE, SLAB_T, ROOM_Z]} scale={ROOM_SCALE}>
        <LivingRoom loadActive={loadActive} />
      </group>
      <group position={[CUT_CENTRE, GROUND_H + SLAB_T, ROOM_Z]} scale={ROOM_SCALE}>
        <Bedroom loadActive={loadActive} />
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
        {/* Sheen, not plain Lambert-ish diffuse. A matte standard material
            falls off to a uniform flat tone away from the key light, which
            is precisely what makes untextured white massing look like a
            drawing of a wall. Sheen adds the grazing-angle lift real plaster
            and painted render have, so the volume keeps describing its own
            curvature at the silhouette instead of dying to a flat fill. */}
        <meshPhysicalMaterial
          color={STUDIO.wall}
          roughness={0.82}
          metalness={0}
          sheen={0.45}
          sheenRoughness={0.75}
          sheenColor="#ffffff"
        />
      </RoundedBox>
      <RoundedBox
        args={[GLAZED_W, UPPER_H, UPPER_D]}
        radius={0.04}
        smoothness={4}
        position={[GLAZED_CENTRE, GROUND_H + UPPER_H / 2, (GROUND_D - UPPER_D) / 2]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={STUDIO.wallSide}
          roughness={0.82}
          metalness={0}
          sheen={0.45}
          sheenRoughness={0.75}
          sheenColor="#ffffff"
        />
      </RoundedBox>

      {/* Slim shadow-line reveal between storeys on the closed wing */}
      <mesh position={[GLAZED_CENTRE, GROUND_H, GROUND_HALF_D + 0.005]}>
        <boxGeometry args={[GLAZED_W + 0.02, 0.04, 0.02]} />
        <meshStandardMaterial color={STUDIO.trim} roughness={0.7} />
      </mesh>

      {/* Glazing on the closed wing only — the open wing shows real rooms */}
      {/* Ground-floor glazing, widened with the wing. Sosen's plant view (and
          the original reference) run near-full-height glass with slim
          mullions; small punched openings in a white box are one of the
          things that make ours read as a model of a house rather than a
          house. RecessedWindow adds a mullion per 0.5 of width, so widening
          gains divisions rather than one oversized pane. */}
      <RecessedWindow position={[GROUND_WIN_X, 0.74, GROUND_HALF_D]} width={GROUND_WIN_W} height={0.86} lit={loadActive} />
      {/* Upper-storey glazing.
          Z was GROUND_HALF_D - (GROUND_D - UPPER_D) = 0.775, which is not a
          wall at all: the upper volume is centred at z = 0.125 with a half
          depth of 0.9, so its front face is at 1.025 and this window sat 0.25
          units *buried inside the solid*. It has therefore been invisible,
          which is exactly the "upstairs has no windows" that was reported.
          The upper front face is flush with the ground floor's, so both
          windows share GROUND_HALF_D. */}
      <RecessedWindow
        position={[UPPER_WIN_X, GROUND_H + UPPER_H * 0.5, GROUND_HALF_D]}
        width={UPPER_WIN_W}
        height={0.62}
        lit={loadActive}
      />
      {/* Second upper window over the undercroft, so the oversailing volume
          reads as occupied rather than as a blank slab. */}
      <RecessedWindow
        position={[UNDERCROFT_CENTRE, GROUND_H + UPPER_H * 0.5, UNDERCROFT_Z + UNDERCROFT_D / 2]}
        width={1.0}
        height={0.58}
        lit={loadActive}
      />
      <RecessedWindow position={[-HALF_W, 0.76, -0.3]} width={1.0} height={0.78} face="left" lit={loadActive} />

      {/* Flat roof carrying the solar array, spanning both wings. Seats on
          WALL_TOP with no rotation — see the ROOF_T block above for why the
          pitch had to go. */}
      <group position={[0, WALL_TOP, ROOF_Z]}>
        <RoundedBox args={[W + 0.26, ROOF_T, ROOF_D]} radius={0.03} smoothness={3} position={[0, ROOF_T / 2, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={STUDIO.roof} roughness={0.75} metalness={0.02} />
        </RoundedBox>
        <group position={[0, ROOF_T + 0.02, ARRAY_Z]}>
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
