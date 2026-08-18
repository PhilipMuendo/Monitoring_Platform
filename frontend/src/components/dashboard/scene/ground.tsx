"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { SceneLighting } from "@/lib/power-flow-colors";
import { CAMERA_FACING, CAMERA_TARGET, fitZoom } from "@/lib/scene-camera";

// An invisible floor that only shows the shadow the scene casts onto it
// (THREE.ShadowMaterial), so the house is grounded without a visible slab.
//
// Deliberately faint. This carries the *direction* of the key light; the
// actual sense of objects resting on the floor comes from the drei
// <ContactShadows> pass in fleet-3d-power-flow.tsx, which derives each
// object's real silhouette instead of smearing one soft ellipse under it.
export function ShadowFloor({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <shadowMaterial transparent opacity={opacity} />
    </mesh>
  );
}

/** How far behind the look-at point the sky sits. Inside the camera's far=60. */
const BACKDROP_DISTANCE = 25;
/** A little larger than the frame, so no rounding can expose an edge. */
const BACKDROP_MARGIN = 1.06;

/**
 * The sky: a gradient plane, camera-facing and sized to exactly the frame.
 *
 * BOTH OF THOSE MATTER, AND NEITHER WAS TRUE BEFORE. It used to be a fixed
 * 60x34 plane lying in the XY axis plane at z = -14, and the consequence is
 * worth writing down because it was invisible for a long time and then looked
 * like a colour bug.
 *
 * The camera is orthographic and looks down about 20 degrees, so a point on
 * that plane projected to screen height v = -0.224X + 0.941Y + 2.458. Solving
 * for the top and bottom of the panel puts the visible band at texture rows
 * 0.61 to 0.89 — the bottom third. Every stop above that, including the whole
 * top half of the gradient, was off screen. Whatever colour the zenith was set
 * to, what actually rendered was a sliver near the bottom of the ramp, and the
 * sky read as one flat near-white no matter what was done to it.
 *
 * Facing the plane at the camera and sizing it to width/zoom x height/zoom
 * makes the texture map 1:1 onto the panel: row 0 is the top of the frame,
 * row 1 is the bottom, and a stop means what it says. `fitZoom` is shared with
 * ResponsiveCamera precisely so the two cannot drift.
 *
 * Nothing lights this plane — it is a meshBasicMaterial, so it is the one
 * surface that cannot take its day/night from the light rig and has to carry
 * the colours itself.
 */
export function GradientBackdrop({ lighting }: { lighting: SceneLighting }) {
  const { backdropTop, background, backdropBottom, skyHorizon } = lighting;

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // FOUR stops, not three. The added one is `skyHorizon`, the pale band low
    // in the sky, and it is doing a specific job: the lawn does not end at an
    // edge, it dissolves, and against a flat sky that dissolve read as the
    // grass texture simply running out. A real sky is palest near the horizon
    // — more atmosphere to scatter through — so putting the light band exactly
    // where the ground fades turns that boundary into distance rather than a
    // missing edge.
    //
    // Now that the plane maps 1:1 onto the panel, these fractions are screen
    // positions: 0 is the top of the frame and 1 the bottom. 0.50 is where the
    // lawn's far edge lands at the centre of frame (v ~ 0.4 of 3.07). The
    // callout labels sit at 64px from the top, which is row 0.08-0.12 across
    // the sizes this panel reaches — solidly in the zenith, which is what the
    // ink contrast in power-flow-colors.ts is checked against.
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, backdropTop);
    gradient.addColorStop(0.3, background);
    gradient.addColorStop(0.5, skyHorizon);
    gradient.addColorStop(1, backdropBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);

    const tex = new THREE.CanvasTexture(canvas);
    // Tagged sRGB, which it was not before. A CanvasTexture defaults to no
    // colour space, so three took these bytes as already-linear and rendered
    // the backdrop lighter than its own hex values — and lighter than the
    // clear colour behind it, which IS colour-managed. Invisible while every
    // stop was near-white; not invisible at all once the night sky is #141a24,
    // which would have washed out to a mid blue-grey.
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [backdropTop, background, backdropBottom, skyHorizon]);

  // Built here rather than by r3f, so r3f will not free it — and the whole
  // Canvas unmounts on every 2D/3D toggle.
  useEffect(() => () => texture?.dispose(), [texture]);

  const { size } = useThree();
  const zoom = fitZoom(size.width, size.height);
  const planeW = (size.width / zoom) * BACKDROP_MARGIN;
  const planeH = (size.height / zoom) * BACKDROP_MARGIN;

  // Centred on the camera's own axis, pushed back behind everything.
  const position = useMemo(
    () =>
      new THREE.Vector3(...CAMERA_TARGET).addScaledVector(
        CAMERA_FACING.towardCamera,
        -BACKDROP_DISTANCE,
      ),
    [],
  );

  if (!texture) return null;

  return (
    <mesh position={position} quaternion={CAMERA_FACING.quaternion} renderOrder={-1}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial map={texture} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Night sky
//
// WHY THE SKY GETS CONTENT INSTEAD OF GETTING SMALLER.
//
// The obvious fix for a large empty sky is to push the lawn further back until
// it fills more of the frame. It does not work here, and the reason is
// checkable rather than aesthetic: this camera sits about 20 degrees above the
// horizon, so reaching the TOP CORNERS of the panel needs ground out at
// roughly x = -11.8, z = -12.8. A plot that big stops being a plot — it covers
// the entire frame and there is no sky left at all, which is the exact failure
// the fade in scene/compound.tsx was built to avoid.
//
// So the band is structural. Given that, the answer is to make it worth
// looking at: a brighter horizon in every phase (see the gradient above), and
// at night, stars.

/**
 * How far back the stars sit.
 *
 * Comfortably in front of the sky: this plane is about 14 units behind the
 * look-at point along the view axis, and the backdrop is BACKDROP_DISTANCE
 * (25) behind it. Far enough back that nothing in the scene can be behind it,
 * near enough that the backdrop still reads as further away.
 */
const STAR_Z = -13.5;
const STAR_COUNT = 340;

/**
 * Screen position -> a point on the star plane.
 *
 * Stars are placed by where they should APPEAR, not by picking world
 * coordinates and hoping. The visible slice of a plane this far back is a
 * narrow slanted band — at z = -13.5 the whole of the on-screen sky is about
 * three world units of Y — so scattering points uniformly over the plane would
 * put about 4% of them in frame and the rest nowhere.
 *
 * Inverted from the same projection used throughout the compound:
 *   u = 0.749X + 8.675      (at this z)
 *   v = -0.224X + 0.941Y + 2.331
 */
function skyPoint(u: number, v: number): [number, number] {
  const x = (u - 8.6749) / 0.749;
  const y = (v + 0.224 * x - 2.331) / 0.941;
  return [x, y];
}

/** Deterministic hash in [0,1), so the constellations never reshuffle. */
function starHash(i: number, salt: number) {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function buildStarField() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    // Sampled well beyond the frame (u +/-5.3, v +/-3.07 at the largest) so
    // the field still covers the sky on a wide wall panel and a narrow
    // dashboard one without regenerating.
    const u = (starHash(i, 1) * 2 - 1) * 7.5;
    // Biased upward: density thins toward the horizon, the way it does in a
    // real sky where you are looking through more atmosphere. Linear sampling
    // made a suspiciously even wallpaper of dots.
    const v = 0.7 + Math.pow(starHash(i, 2), 0.65) * 2.9;
    const [x, y] = skyPoint(u, v);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = STAR_Z;

    // Mostly faint, a handful bright. A field of equally bright dots reads as
    // noise; the variation is what makes it read as depth.
    const t = starHash(i, 3);
    const brightness = 0.22 + Math.pow(t, 3) * 0.78;
    // Very slightly cool, and a few warmer, rather than pure white.
    const warm = starHash(i, 4) > 0.82;
    colors[i * 3] = brightness * (warm ? 1 : 0.86);
    colors[i * 3 + 1] = brightness * (warm ? 0.94 : 0.9);
    colors[i * 3 + 2] = brightness * (warm ? 0.84 : 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const MOON_PX = 128;

/**
 * The moon: a small hard disc inside a wide soft halo.
 *
 * The halo is not decoration. A bare disc on a gradient reads as a sticker,
 * because nothing else in a night sky has a hard edge against nothing; the
 * glow is what places it *in* the atmosphere. Stops are weighted toward the
 * centre so the falloff is steep near the disc and long in the tail, which is
 * how scattering actually behaves.
 */
function buildMoonTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = MOON_PX;
  canvas.height = MOON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const half = MOON_PX / 2;
  const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, "rgba(232,240,252,1)");
  glow.addColorStop(0.24, "rgba(228,237,251,1)");
  // The disc edge. Kept slightly soft rather than a hard cut — at the size
  // this renders (about 25px across) a crisp edge aliases into a cog.
  glow.addColorStop(0.3, "rgba(200,216,240,0.5)");
  glow.addColorStop(0.42, "rgba(150,175,215,0.16)");
  glow.addColorStop(1, "rgba(120,150,200,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, MOON_PX, MOON_PX);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Stars and a moon, mounted only for the night phase.
 *
 * Points rather than dots baked into the backdrop texture, and that is the
 * whole design decision. The backdrop plane is 60x34 world units but only
 * about 13x6.5 of it is ever on screen, so a baked star would be a texel
 * magnified some thirty times — a soft grey square, not a star. Points with
 * sizeAttenuation off are sized in PIXELS, so they stay crisp at every zoom
 * the responsive camera produces.
 *
 * The material is deliberately NOT transparent. That puts the field in the
 * opaque pass where it writes depth, so the building occludes it correctly,
 * while the lawn — which is transparent and drawn later — still paints over
 * any star that falls below the horizon.
 */
export function NightSky() {
  const geometry = useMemo(() => buildStarField(), []);
  const moonTexture = useMemo(() => buildMoonTexture(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => moonTexture?.dispose(), [moonTexture]);

  // Upper RIGHT, which is both the free corner and the honest one: the night
  // key light sits at [5, 8, -2], so the moonlight in this scene comes from
  // the right, and putting the moon on the left would light the building from
  // the opposite side to its own source.
  //
  // The callout labels are pinned in screen space 64px from the top, landing
  // between v = 2.3 and v = 2.6 depending on zoom, and the rightmost of them
  // (Grid, on the pylon) sits near u = 2.6. u = 4.2 clears it at every panel
  // size this component realistically gets. On a very narrow panel the width
  // term of the zoom law takes over and the moon simply falls outside the
  // frame, which is fine — it is scenery, not information.
  const [moonX, moonY] = skyPoint(4.2, 2.6);

  return (
    <group>
      <points geometry={geometry}>
        <pointsMaterial
          size={1.7}
          // Pixel-sized, not world-sized — see the note above.
          sizeAttenuation={false}
          vertexColors
          toneMapped={false}
        />
      </points>

      {/* A SPRITE, not a circle. The star plane lies in XY at z = -13.5 while
          the camera looks at it from [7.6, 5.2, 8.2], so a flat disc placed
          there is seen at an angle and renders as a visible egg. Sprites are
          rebuilt facing the camera every frame, so the moon stays round.
          It also carries its own halo in the texture, which is most of what
          separates a moon from a white dot. */}
      {moonTexture && (
        <sprite position={[moonX, moonY, STAR_Z]} scale={[1.15, 1.15, 1]}>
          <spriteMaterial
            map={moonTexture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}
