"use client";

import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { STUDIO } from "@/lib/power-flow-colors";
import { HOUSE_OFFSET_X } from "@/lib/scene-layout";

// The site the house stands in: a lawn, a paved drive and apron, and the
// compound's dusk-to-dawn security lighting.
//
// WHY THIS IS A BOUNDED PLOT AND NOT A GROUND PLANE.
//
// Before this the scene had no visible ground at all. What read as white
// ground was the vertical GradientBackdrop plus the ContactShadows pass;
// ShadowFloor is a shadowMaterial, so it is invisible except where a shadow
// lands on it. Adding a floor is therefore a genuinely new element, and the
// camera makes it a trap: it sits only ~20 deg above the horizon
// (direction.y = -0.339), so the y=0 plane projects all the way to the TOP of
// the frame. An unbounded green plane does not give a lawn with sky above it —
// it turns the entire panel green and deletes the backdrop.
//
// So the lawn is a finite plot that FADES OUT before it reaches the frame
// edge, via an alpha ramp baked into its texture. No horizon line, no far edge
// to align, and nothing new competing with the roof for the skyline — which
// matters because the company's complaint about this panel was that the
// building read too small, and anything drawing a line across the frame above
// the eaves works against that.
//
// The camera framing is NOT re-derived for any of this. ZOOM_PER_PX_WIDTH in
// fleet-3d-power-flow.tsx is a hand-fitted constant, and its own comment
// records that getting it wrong once made the scene smaller. Everything here
// is sized to fit the frame that already exists — like GradientBackdrop, it is
// environment the camera does not account for, not an object it must fit.

// ---------------------------------------------------------------------------
// Plot extents
//
// Asymmetric, because the camera is. Derived by projecting corners through the
// actual camera basis (position [7.6,5.2,8.2] looking at [0.35,1.25,0]):
//
//   u(x,z)   =  0.749(x - 0.35) - 0.662 z          [screen horizontal]
//   v(x,y,z) = -0.224x + 0.941y - 0.254z - 1.098   [screen vertical]
//
// with the panel spanning u = +/-5.31 and v = +/-3.07 at the dashboard's size.
// Checked against the built scene: the pylon at [2.7, 0, -1.25] lands at
// u = 2.59, and it measures at u = 2.60 on screen.
//
// The requirements those numbers have to satisfy:
//   - the solid core must cover the building (x -3.2..1.7), the pylon
//     (x 2.7) and the drive, or things stand on transparent ground;
//   - the FAR edge must dissolve below the eaves (v = 1.115) so no green
//     haze crowns the roof;
//   - the NEAR edge must dissolve past the bottom of the frame (v = -3.07)
//     so the lawn is never seen to stop.
const PLOT_CENTRE_X = 0.5;
const PLOT_CENTRE_Z = 1.4;
const PLOT_HALF_X = 8.5;
const PLOT_HALF_Z = 7.3;

/**
 * Where the alpha ramp begins, as a fraction of the half-extent.
 *
 * Everything inside this is fully opaque grass, so it is what actually decides
 * how much of the plot is usable: 0.70 puts the solid core at x -5.45..6.45,
 * z -3.71..6.51, which covers the building, the pylon, the drive and all three
 * with margin. Lowering it strands the lamp post and the far end of the drive
 * on half-transparent ground, which reads as floating.
 */
const FADE_START = 0.7;
/**
 * Superellipse exponent for the falloff. 4 gives a rounded rectangle: a plain
 * radial gradient would be an ellipse and would eat the corner the drive runs
 * out through, while max(|x|,|z|) would put a visible straight edge across the
 * frame — the exact thing the fade exists to avoid.
 */
const FADE_EXPONENT = 4;

/**
 * 256 is deliberate, not lazy. The texture is generated per-pixel on the main
 * thread when the canvas mounts, and this is the one piece of scene setup whose
 * cost scales with area: 256 is 65k iterations (a few ms), 512 would be 262k.
 * The wall display's TV browser pays that on every load, and the map is a
 * blurred lawn seen at a grazing angle — there is nothing at 512 to see.
 */
const LAWN_TEXTURE_PX = 256;

// Stacking order on the ground, bottom to top. All within 3 cm, so the steps
// are sub-pixel at panel scale, but the ORDER matters: paving must sit above
// the lawn to be visible, and the ContactShadows plane must sit above both or
// it stops darkening them. ShadowFloor stays at 0.001, below the lawn, where
// it still catches the directional shadow out in the faded region.
const LAWN_Y = 0.003;
const PATH_TOP_Y = 0.016;
const DRIVE_TOP_Y = 0.019;
const APRON_TOP_Y = 0.022;
/** Paving slab thickness. Thin enough that only the bevel reads as an edge. */
const PAVING_T = 0.02;

// ---------------------------------------------------------------------------
// Texture generation

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Deterministic hash in [0,1). Seeded by position, so the lawn is stable. */
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Bilinear value noise over an integer lattice — the mottling of the grass. */
function valueNoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Builds the lawn map: mottled grass in RGB, plot falloff in alpha.
 *
 * Colours are interpolated as raw sRGB bytes rather than through THREE.Color.
 * THREE.Color parses a hex string as sRGB and converts it into the linear
 * working space, so writing its components into a texture tagged
 * SRGBColorSpace would encode the value twice and come out visibly dark. Two
 * near-identical greens do not need a perceptually correct blend.
 */
function buildLawnTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = LAWN_TEXTURE_PX;
  canvas.height = LAWN_TEXTURE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(LAWN_TEXTURE_PX, LAWN_TEXTURE_PX);
  const data = image.data;
  const base = hexToRgb(STUDIO.grass);
  const alt = hexToRgb(STUDIO.grassAlt);

  for (let py = 0; py < LAWN_TEXTURE_PX; py++) {
    for (let px = 0; px < LAWN_TEXTURE_PX; px++) {
      const u = px / (LAWN_TEXTURE_PX - 1);
      const w = py / (LAWN_TEXTURE_PX - 1);

      // Broad patches plus a finer break-up, then a per-pixel speckle. The
      // speckle mostly disappears into the mipmaps at this camera distance,
      // which is the point — it keeps the surface from looking like flat paint
      // up close without adding anything that shimmers when it recedes.
      const patches = valueNoise(u * 6, w * 6) * 0.62 + valueNoise(u * 17, w * 17) * 0.38;
      const speckle = hash2(px * 1.7, py * 2.3) * 0.18 - 0.09;
      const t = clamp01(patches + speckle);

      // Superellipse distance from the plot centre, normalised so 1.0 is the
      // plot edge.
      const nx = Math.abs(u * 2 - 1);
      const nz = Math.abs(w * 2 - 1);
      const r = Math.pow(nx ** FADE_EXPONENT + nz ** FADE_EXPONENT, 1 / FADE_EXPONENT);
      const alpha = 1 - smoothstep(FADE_START, 1, r);

      const i = (py * LAWN_TEXTURE_PX + px) * 4;
      data[i] = base[0] + (alt[0] - base[0]) * t;
      data[i + 1] = base[1] + (alt[1] - base[1]) * t;
      data[i + 2] = base[2] + (alt[2] - base[2]) * t;
      data[i + 3] = alpha * 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The plot is seen at a grazing angle, which is exactly the case trilinear
  // filtering alone smears into mush.
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The lawn.
 *
 * receiveShadow, so the building's directional shadow lands on the grass
 * rather than only on the ShadowFloor underneath it — that shadow is most of
 * what makes the house look seated in the plot rather than pasted onto it.
 *
 * depthWrite is off because the plane is transparent at its edges; the paving
 * above it is opaque and writes depth in the earlier pass, so the lawn is
 * still correctly occluded where a slab covers it.
 */
function Lawn() {
  const texture = useMemo(() => buildLawnTexture(), []);

  // Built outside r3f's reconciler, so r3f will not free it — and the whole
  // Canvas unmounts on every 2D/3D toggle. Same reasoning as GradientBackdrop.
  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;

  return (
    <mesh
      position={[PLOT_CENTRE_X, LAWN_Y, PLOT_CENTRE_Z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[PLOT_HALF_X * 2, PLOT_HALF_Z * 2]} />
      <meshStandardMaterial
        map={texture}
        transparent
        depthWrite={false}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Hard landscape
//
// Three slabs, all connected: an apron in front of the undercroft, a drive
// running off the left of the frame, and a path along the front of the house.
//
// The drive leaves to the LEFT rather than toward the camera on purpose. This
// camera's frame bottom is enormously far forward — at x = -2.45 the bottom
// edge of the panel is z = 9.9, past the plot entirely — so a drive running
// toward the viewer would visibly stop in open lawn. Running left it crosses
// the frame edge at x = -5.4 and reads as continuing off-site.
//
// The apron is also what keeps the undercroft legible now that the car is
// gone: a covered bay with a paved apron in front of it still reads as a
// carport, where a bare bay reads as a hole.
// The apron runs BACK to z = -0.8, under the undercroft, so it floors the bay
// rather than stopping at the facade. First version stopped at z = 0.9 and
// left the carport standing on grass, which is the one thing a carport never
// is — and with the car gone the floor is now the only thing saying what that
// bay is for.
const APRON = { position: [-2.45, APRON_TOP_Y - PAVING_T / 2, 0.9] as const, size: [1.9, 3.4] as const };
const DRIVE = { position: [-4.9, DRIVE_TOP_Y - PAVING_T / 2, 1.75] as const, size: [3.4, 0.9] as const };
// Runs from the drive along the frontage and stops at the building's corner.
// Both extremes were wrong: ending it early left it stopping in open lawn, and
// running it the full width of the plot took it PAST the house and into empty
// lawn on the other side, because it cannot reach the right-hand frame edge
// without leaving the plot entirely (u would need x = 11.3). Ending it on the
// building is the only version that reads as a path to somewhere.
const PATH = { position: [-1.05, PATH_TOP_Y - PAVING_T / 2, 1.85] as const, size: [3.1, 0.6] as const };

/**
 * A paved slab.
 *
 * RoundedBox rather than a plain box, matching house.tsx: a sharp 90-degree
 * edge is the loudest CG tell in the scene, and at this thickness the bevel is
 * the only part of the slab's edge that is actually visible.
 */
function Slab({
  position,
  size,
}: {
  position: readonly [number, number, number];
  size: readonly [number, number];
}) {
  return (
    <RoundedBox
      args={[size[0], PAVING_T, size[1]]}
      radius={0.008}
      smoothness={2}
      position={[position[0], position[1], position[2]]}
      receiveShadow
    >
      <meshStandardMaterial color={STUDIO.paving} roughness={0.85} metalness={0} />
    </RoundedBox>
  );
}

// ---------------------------------------------------------------------------
// Planting: none.
//
// Three stylised low-poly trees stood here and were cut on sight — they read
// as blobs on sticks next to a building with bevelled edges, real contact
// shadows and ambient occlusion. That gap is the actual lesson: the rest of
// the scene is primitives too, but they are ARCHITECTURAL primitives, where a
// box genuinely is the shape of the thing. A faceted sphere is not the shape
// of a tree, so the same technique that reads as clean massing on a house
// reads as a placeholder on foliage.
//
// If planting is wanted later, the cheap stylised route is the one thing that
// has been tried and rejected, so it would need either a real (compressed)
// model or nothing. Alpha-tested foliage cards remain a bad idea regardless:
// they defeat early-Z and multiply overdraw on the wall display's Smart TV
// browser, and they confuse the N8AO depth pass, which samples depth the
// cutout never wrote.

// ---------------------------------------------------------------------------
// Security lighting
//
// Dusk-to-dawn lamps on the compound: two on poles and one on the wall over
// the apron. Lit for the "dusk" and "night" phases, dark through the day.
//
// HOW THIS IS BUILT IS A PERFORMANCE DECISION, not a stylistic one. The
// obvious implementation — a shadow-casting spotLight per lamp — is three
// extra shadow maps and three extra light contributions on every shader in
// the scene, on a panel that has to run in a Smart TV's browser. What is here
// instead is:
//
//   - an emissive head, so the lamp itself is visibly the source;
//   - a soft pool on the ground, drawn as one additively-blended quad per
//     lamp against a shared radial texture, which costs nothing and is what
//     actually reads as "that lamp is lighting the yard";
//   - exactly two real pointLights, unshadowed and distance-limited, to give
//     nearby geometry some directional falloff.
//
// The pools do the visual work and the lights do the physical work, which is
// the opposite of how it looks and roughly a tenth of the cost.

const LAMP_GLOW_PX = 128;

/** Radial falloff, shared by every light pool — one texture, three quads. */
function buildGlowTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = LAMP_GLOW_PX;
  canvas.height = LAMP_GLOW_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const half = LAMP_GLOW_PX / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  // Deliberately not linear. A straight ramp reads as a flat disc with a
  // hard-ish rim; weighting the stops toward the centre gives the bright core
  // and long tail that a real luminaire throws.
  gradient.addColorStop(0, "rgba(255,241,214,0.95)");
  gradient.addColorStop(0.25, "rgba(255,234,190,0.55)");
  gradient.addColorStop(0.55, "rgba(255,226,170,0.2)");
  gradient.addColorStop(1, "rgba(255,220,160,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LAMP_GLOW_PX, LAMP_GLOW_PX);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The pool of light a lamp throws on the ground.
 *
 * AdditiveBlending, so it brightens whatever is under it instead of painting
 * a beige disc over it — the difference between light falling on grass and a
 * sticker of light lying on grass. depthWrite off for the same reason every
 * other ground layer has it off; it is drawn above the paving.
 */
function LightPool({
  position,
  radius,
  intensity,
  texture,
}: {
  position: [number, number, number];
  radius: number;
  intensity: number;
  texture: THREE.Texture;
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={intensity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * A lamp head — the emissive part, plus its mount.
 *
 * `toneMapped={false}` on the lens matters more than it looks: Neutral tone
 * mapping compresses highlights, which is right for white plaster and wrong
 * for something that is supposed to be a light source. Left mapped, the lamp
 * renders as a slightly pale square rather than as something switched on.
 */
function LampHead({ position, lit }: { position: [number, number, number]; lit: boolean }) {
  return (
    <group position={position}>
      {/* A dark shade over the lens, so the head reads as a luminaire pointing
          down rather than as a glowing brick. Without it the emissive box was
          lit on all six faces and rendered as a small white flag on the end of
          the pole — the emissive face has to be the only one you can see. */}
      <mesh position={[0, 0.022, 0]}>
        <boxGeometry args={[0.12, 0.028, 0.1]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.55} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.004, 0]}>
        <boxGeometry args={[0.105, 0.018, 0.085]} />
        <meshStandardMaterial
          color={lit ? "#fff3d6" : STUDIO.cabinetTrim}
          emissive={lit ? "#ffe9b8" : "#000000"}
          emissiveIntensity={lit ? 1.5 : 0}
          roughness={0.5}
          metalness={0.2}
          toneMapped={!lit}
        />
      </mesh>
    </group>
  );
}

/** A lamp on a pole, at the edge of the paving. */
function LampPole({ position, height, lit }: { position: [number, number, number]; height: number; lit: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.03, height, 8]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.6} metalness={0.5} />
      </mesh>
      {/* Short arm, so the head overhangs the paving rather than sitting on
          the pole's axis — which is what makes it read as a street lamp
          instead of a bollard. */}
      <mesh position={[0.09, height, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.016, 0.016, 0.18, 6]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.6} metalness={0.5} />
      </mesh>
      <LampHead position={[0.18, height - 0.03, 0]} lit={lit} />
    </group>
  );
}

// ONE pole, not two. A second stood at [2.6, 0, 1.6] — open lawn in world
// space, and on screen a mast planted squarely across the cutaway living
// room, which is the one part of the building the scene most wants you to
// look into. Worth keeping in mind if a second is ever added: screen position
// here depends on x AND z together, so "clear of the house" in world space is
// not the same test as "clear of the house" in frame.
const POLE_A: [number, number, number] = [-3.6, 0, 2.2];
const POLE_HEIGHT = 1.15;
/**
 * Wall-mounted lamp over the apron, on the undercroft's front face.
 *
 * z is 1.06, a whisker proud of the facade plane at 1.025 — far enough not to
 * z-fight, close enough to read as mounted rather than floating.
 */
const WALL_LAMP: [number, number, number] = [-1.95, 1.18, 1.06];

function SecurityLights({ lit }: { lit: boolean }) {
  const texture = useMemo(() => (lit ? buildGlowTexture() : null), [lit]);
  useEffect(() => () => texture?.dispose(), [texture]);

  return (
    <group>
      <LampPole position={POLE_A} height={POLE_HEIGHT} lit={lit} />
      <LampHead position={WALL_LAMP} lit={lit} />

      {lit && texture && (
        <>
          {/* Pools sit just above the paving so they brighten the slabs too. */}
          <LightPool position={[POLE_A[0] + 0.18, 0.028, POLE_A[2]]} radius={1.7} intensity={0.7} texture={texture} />
          <LightPool position={[WALL_LAMP[0], 0.028, WALL_LAMP[2] + 0.55]} radius={1.3} intensity={0.58} texture={texture} />

          {/* The only two real lights. Distance-limited so their cost stays
              local and they cannot wash out the far side of the building, and
              unshadowed — a shadow map each would roughly double the scene's
              shadow work to darken ground that is already dark. */}
          <pointLight
            position={[POLE_A[0] + 0.18, POLE_HEIGHT - 0.05, POLE_A[2]]}
            color="#ffe3ad"
            intensity={2.6}
            distance={4.5}
            decay={2}
          />
          <pointLight
            position={[WALL_LAMP[0], WALL_LAMP[1], WALL_LAMP[2] + 0.15]}
            color="#ffe3ad"
            intensity={1.8}
            distance={3.2}
            decay={2}
          />
        </>
      )}
    </group>
  );
}

/**
 * The whole site: lawn, paving, planting and security lighting.
 *
 * Rendered before the building in fleet-3d-power-flow.tsx so the opaque paving
 * is laid down first, but nothing here depends on that order.
 */
export function Compound({ securityLights }: { securityLights: boolean }) {
  return (
    // HOUSE_OFFSET_X (see lib/scene-layout.ts): the house itself shifts by
    // the same amount via its own group position in house.tsx — the lawn,
    // apron, drive, path and lamp posts here all move with it so the
    // paving stays under the building it was laid for, rather than
    // floating wherever it used to be relative to the pre-shift house.
    <group position={[HOUSE_OFFSET_X, 0, 0]}>
      <Lawn />
      <Slab position={APRON.position} size={APRON.size} />
      <Slab position={DRIVE.position} size={DRIVE.size} />
      <Slab position={PATH.position} size={PATH.size} />
      {/* Mounted in every phase, lit in some. The poles and heads are part of
          the site whether or not they are switched on, and unmounting them by
          day would make them pop into existence at dusk. */}
      <SecurityLights lit={securityLights} />
    </group>
  );
}
