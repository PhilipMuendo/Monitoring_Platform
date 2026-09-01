"use client";

import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NeutralToneMapping, type OrthographicCamera as ThreeOrthographicCamera } from "three";

import { BatteryPack, BATTERY_ANCHOR } from "@/components/dashboard/scene/battery-pack";
import { Compound } from "@/components/dashboard/scene/compound";
import { GradientBackdrop, NightSky, ShadowFloor } from "@/components/dashboard/scene/ground";
import { MODEL_CREDITS } from "@/components/dashboard/scene/model-credits";
import { GridPylon, PYLON_ANCHOR } from "@/components/dashboard/scene/grid-pylon";
import {
  House,
  HOUSE_HUB_ANCHOR,
  HOUSE_LOAD_ANCHOR,
  HUB_LEFT_X,
  HUB_TOP_Y,
  ROOF_FRONT_Z,
  SOLAR_DROP_X,
  SOLAR_PANEL_ANCHOR,
} from "@/components/dashboard/scene/house";
import { PowerFlowCallout3D } from "@/components/dashboard/scene/power-flow-callout-3d";
import { PowerFlowEdge3D } from "@/components/dashboard/scene/power-flow-edge-3d";
import { useRenderActive } from "@/hooks/use-render-active";
import { useTimeOfDay } from "@/hooks/use-time-of-day";
import { useWebGLTier } from "@/hooks/use-webgl-support";
import { formatPercent, formatPower } from "@/lib/format";
import { SCENE_LIGHTING, type SceneLighting } from "@/lib/power-flow-colors";
import {
  CAMERA_POSITION,
  CAMERA_TARGET,
  CAMERA_ZOOM,
  REFERENCE_HEIGHT,
  fitZoom,
} from "@/lib/scene-camera";
import type { PowerFlowScene } from "@/lib/power-flow-model";
import { scalePowerFlowSpeed } from "@/lib/power-flow-scale";
import { HOUSE_OFFSET_X } from "@/lib/scene-layout";
import { cn } from "@/lib/utils";

// World-space versions of the house's anchors. house.tsx deliberately
// exports these LOCAL to the house's own coordinate space (see the long
// note on HOUSE_OFFSET_X there) because several of them also position
// meshes INSIDE the house's own group — but every routing waypoint and
// callout anchor below is a true world-space point, rendered as a SIBLING
// of the house, not a child of it, so this is the one place that has to
// add the shared offset back in. Everything past this point uses these
// _W names, never the raw imports, so there's exactly one place a future
// anchor could be added and forgotten to offset — right here.
const HOUSE_HUB_ANCHOR_W: [number, number, number] = [
  HOUSE_HUB_ANCHOR[0] + HOUSE_OFFSET_X,
  HOUSE_HUB_ANCHOR[1],
  HOUSE_HUB_ANCHOR[2],
];
const HOUSE_LOAD_ANCHOR_W: [number, number, number] = [
  HOUSE_LOAD_ANCHOR[0] + HOUSE_OFFSET_X,
  HOUSE_LOAD_ANCHOR[1],
  HOUSE_LOAD_ANCHOR[2],
];
const SOLAR_PANEL_ANCHOR_W: [number, number, number] = [
  SOLAR_PANEL_ANCHOR[0] + HOUSE_OFFSET_X,
  SOLAR_PANEL_ANCHOR[1],
  SOLAR_PANEL_ANCHOR[2],
];
const SOLAR_DROP_X_W = SOLAR_DROP_X + HOUSE_OFFSET_X;
const HUB_LEFT_X_W = HUB_LEFT_X + HOUSE_OFFSET_X;

// Split out of this chunk on purpose — `postprocessing` is a large library
// that only the "full" WebGL2 tier can use, and bundling it here made every
// WebGL1 device (the wall display's TV among them) pay for it. See
// scene/ambient-occlusion.tsx for the full reasoning.
const AmbientOcclusion = lazy(() =>
  import("@/components/dashboard/scene/ambient-occlusion").then((m) => ({
    default: m.AmbientOcclusion,
  })),
);

// THE SCENE DOWNLOADS NO ASSETS. Everything below is procedural geometry
// built at mount, so once this chunk has arrived there is nothing else on the
// wire — no models, and no Draco decoder either.
//
// It used to ship a 4 MB car.glb which, with its ~750 KB decoder, was more
// than three times the size of this entire chunk. It was removed for four
// reasons, of which bandwidth was only the first: it also cost a main-thread
// Draco decode of ~162k vertices for something that renders about 40px wide;
// it carried a CC BY 4.0 attribution obligation that had to be printed on the
// panel; and — the one that settled it — its red paint was the most saturated
// thing in the render, louder than any of the four semantic flow colours, so
// the eye went to a parked car instead of to the power flow. The undercroft
// still reads as a carport because scene/compound.tsx puts a paved apron in
// front of it.
//
// The loader scaffolding (scene/gltf-model.tsx, public/decoders/draco/) is
// kept for the next asset that needs it. It costs nothing while unused: no
// module imports it, so it is tree-shaken out of this chunk entirely, and the
// decoders are static files nothing requests.

// THE SCENE DOES NOT FOLLOW THE APP THEME. It never has — the render is a
// clean, well-lit architectural view whether or not the dashboard around it is
// dark. What it follows now is the CLOCK IN KENYA: day, dusk or night at the
// installations, from lib/time-of-day.ts.
//
// Those are two different axes and it matters that they stay separate. The
// app theme is a preference about the UI; the phase is a fact about the sites.
// A night scene inside a light-themed dashboard is correct, and so is the
// reverse. See SCENE_LIGHTING in lib/power-flow-colors.ts for what each phase
// changes — almost entirely lighting, because that is what time of day is.

// ---------------------------------------------------------------------------
// Conduit routing
//
// Every service converges on the inverter, because that is what an inverter
// is: the point where PV, battery, grid and house loads actually meet.
//
// Runs are authored as orthogonal waypoints — vertical drops, horizontal runs,
// right-angle turns — rather than as smooth curves through open air. See the
// long note in scene/power-flow-edge-3d.tsx for why.
//
// FOUR SERVICES, FOUR ENTRY POINTS. Each run approaches the inverter from
// its own side, which is what keeps them legible:
//
//   solar   -> TOP            (down from the roof, on the left)
//   grid    -> LEFT           (in from the pylon, on the left of the house)
//   battery -> BOTTOM (west)  (up from below, the way a real battery-to-
//                              inverter DC run is wired — see BATTERY_ROUTE)
//   load    -> BOTTOM (east)  (out and along to the television)
//
// Battery and load share the bottom face rather than a face each — an
// inverter only has four sides and TOP/LEFT are already solar/grid's — but
// they enter at different X offsets either side of hub centre and travel
// in opposite directions once they're down at skirting level, so the two
// runs never overlap or read as one thick line. See BATTERY_ENTRY_X below.
//
// THE SAFE-Z RULE. The building is solid volume for x in [-1.7, 1.7]
// (HALF_W) at y = HUB_Y — the undercroft bay to the left of that (down to
// x = -3.2) is open at ground level, but the main body is not. A run may
// only travel in X while inside that x-range if z is already >= FACADE_Z
// (in front of the building) or <= -GROUND_HALF_D (behind it) for the
// WHOLE of that traversal — otherwise it draws a line straight through the
// walls. Both routes below do their X-travel while already out at a safe
// Z (GRID_ROUTE behind, BATTERY_ROUTE in front, since that's where each
// object now actually stands), and only change Z while still out at an X
// clear of the building (in the open undercroft/yard), never both against
// the building at once.
//
// The facade's front face is z = 1.025 and the eaves overhang to
// ROOF_FRONT_Z. Solar gets its own shallow plane proud of the wall to clear
// the eaves it drops past.
const Z_SOLAR = ROOF_FRONT_Z + 0.035;
const Z_LOAD = 1.05;
/** Where a run meets the inverter box (0.22 x 0.32, centred on the hub). */
const HUB_FACE_Z = 1.1;
/** Hub centre height — the level the two side entries come in at. */
const HUB_Y = HOUSE_HUB_ANCHOR_W[1];
/**
 * Bottom face of the inverter box, 0.03 into it — mirrors SOLAR_ROUTE's
 * `HUB_TOP_Y - 0.03` from above. The box is vertically centred on HUB_Y
 * (HUB_TOP_Y = HUB_Y + half-height), so its bottom is the same distance
 * below HUB_Y that HUB_TOP_Y is above it: HUB_Y - (HUB_TOP_Y - HUB_Y).
 */
const HUB_BOTTOM_Y = 2 * HUB_Y - HUB_TOP_Y + 0.03;
/**
 * Where the battery's run rises into the bottom face — west of hub centre
 * (HOUSE_HUB_ANCHOR_W[0]), on the same side battery actually stands, and
 * far enough from LOAD_ROUTE's own straight-down exit at hub centre that
 * the two bottom entries read as two distinct lines rather than one.
 */
const BATTERY_ENTRY_X = HOUSE_HUB_ANCHOR_W[0] - 0.09;
/** Skirting height both bottom-entry runs travel along, so they read as one shared datum line rather than two unrelated heights. */
const SKIRT_Y = 0.25;

// Off the panels, forward over the eaves, straight down into the top of the
// inverter. Three waypoints and a single bend — the solar leg is now the
// simplest run in the scene, and the whole of it sits left of the grid.
const SOLAR_ROUTE = [
  SOLAR_PANEL_ANCHOR_W,
  [SOLAR_DROP_X_W, SOLAR_PANEL_ANCHOR_W[1], Z_SOLAR],
  [SOLAR_DROP_X_W, HUB_TOP_Y - 0.03, Z_SOLAR],
] as const;

// Out of the canopy in front of the house, down to skirting height while
// still out on the apron (z = BATTERY_ANCHOR's, always >= FACADE_Z so the
// X-leg that follows can never cross the building's volume — see the
// SAFE-Z RULE above), in to the entry X, forward to the facade at that
// same skirting height, then straight up into the inverter's bottom face —
// the way a real battery-to-inverter DC run is actually wired, rather than
// sideways into it like the grid/solar legs.
const BATTERY_ROUTE = [
  BATTERY_ANCHOR,
  [BATTERY_ANCHOR[0], SKIRT_Y, BATTERY_ANCHOR[2]],
  [BATTERY_ENTRY_X, SKIRT_Y, BATTERY_ANCHOR[2]],
  [BATTERY_ENTRY_X, SKIRT_Y, HUB_FACE_Z],
  [BATTERY_ENTRY_X, HUB_BOTTOM_Y, HUB_FACE_Z],
] as const;

// Overhead service drop from the pylon (now left of the house, behind it —
// see grid-pylon.tsx), down to hub height while still out at the pylon's
// own X (clear of the building entirely, whether over the open undercroft
// or beyond it — no X-range to worry about), across to the front while
// still out at that same clear X, then in along the front to the
// inverter's left face. The middle two legs both move while at an X or Z
// that's already safe per the SAFE-Z RULE above, so the run can never
// appear to pass through the house — unlike the very first draft of this
// route, which swept in X behind the building and then turned to the
// front INSIDE the building's own footprint. Keep that failure mode in
// mind if this ever gets "simplified".
const GRID_ROUTE = [
  PYLON_ANCHOR,
  [PYLON_ANCHOR[0], HUB_Y, PYLON_ANCHOR[2]],
  [PYLON_ANCHOR[0], HUB_Y, HUB_FACE_Z],
  [HUB_LEFT_X_W, HUB_Y, HUB_FACE_Z],
] as const;

// Out of the bottom of the inverter, down to skirting level, along the facade
// UNDER the ground-floor window (its sill is at y ~ 0.31 — run any higher and
// the conduit crosses the glass), in through the open corner, then up the
// partition to the television.
const LOAD_ROUTE = [
  HOUSE_HUB_ANCHOR_W,
  [HOUSE_HUB_ANCHOR_W[0], 0.25, Z_LOAD],
  [HOUSE_LOAD_ANCHOR_W[0], 0.25, Z_LOAD],
  [HOUSE_LOAD_ANCHOR_W[0], 0.25, HOUSE_LOAD_ANCHOR_W[2]],
  HOUSE_LOAD_ANCHOR_W,
] as const;

// ---------------------------------------------------------------------------
// Callout anchors — on the ground, not on the house.
//
// These used to sit AT each quantity's actual anchor height: Solar up on
// the roof, Grid up at the pylon's crossarm, Load inside the house at the
// television. That put the label text overlapping the thing it was meant
// to be a caption for — a callout floating in front of the roof tiles, or
// worse, "Load" rendering inside the walls of the house itself, since its
// real anchor is a point of furniture in a room.
//
// A callout is a caption, not a hologram bolted to the equipment — so
// these sit as small plates on open ground near each object's base
// instead, at the same fixed low height, and each keeps that object's own
// horizontal (X, Z) position so it still reads as belonging to it.
// PowerFlowCallout3D's "top" placement (text above a short rising stem)
// does the rest: the stem points up toward the object without needing to
// literally span the real-world height gap up to a roof or a crossarm.
//
// Solar and Load both have their real anchor INSIDE the building's
// footprint in plan (the roof overhangs the walls; the television sits in
// a room), so their ground point can't just be "the same X/Z at Y = 0" —
// that would put the plate under the floor slab. Both are nudged out to
// just past the front facade instead, onto the open apron/lawn, while
// keeping the anchor's original X (or, for Load, the television's own X,
// not the inverter's — see below) so each stays visually near its object.
// Ground-plate labels (previous approach) put four independent text blocks
// on the same patch of open ground, and no amount of nudging kept them
// from overlapping once two objects' ground points projected close
// together on screen — that's what the "this looks horrible" screenshot
// caught happening between Solar and Battery.
//
// Replaced with a plain reference pattern instead: each label sits at the
// TOP or BOTTOM margin of the frame — sky for Solar/Grid/Load, the ground
// strip below the compound for Battery — connected to its real object by a
// single straight dashed line. Labels only collide if their objects are
// close together on screen AND on the same side (top vs. bottom); spread
// across three top positions (roof, pylon, indoor unit) and one bottom
// position (battery), that doesn't happen. No projected ground point to
// compute or fight with.
const CALLOUT_LEADER = 190;
const BATTERY_LEADER = 170;

// Frames the scene, re-fitting it whenever the canvas is resized.
//
// react-hooks/immutability is disabled below by design. r3f's whole API is
// imperative mutation of a scene graph that lives outside React — the
// renderer reads camera.zoom/matrix each frame, and there is no declarative
// prop for "look at this point". drei's <OrthographicCamera makeDefault> was
// tried instead and mis-frames the scene, because the effect's lookAt runs
// against a world matrix the camera has not been positioned into yet.
function ResponsiveCamera() {
  const { camera, size } = useThree();
  const { width, height } = size;

  useEffect(() => {
    const cam = camera as ThreeOrthographicCamera;

    // Zoom tracks the canvas so the scene grows with the panel instead of
    // sitting at a fixed size inside it. Bound by whichever axis is tighter so
    // the house can never overflow horizontally — see lib/scene-camera.ts,
    // which the backdrop reads too so the sky and the frame cannot disagree.
    // eslint-disable-next-line react-hooks/immutability
    cam.zoom = fitZoom(width, height);

    // Raising the look-at target pushes the scene down the screen. Below the
    // reference height the callouts need more headroom than shrinking alone
    // buys, since Solar anchors to the roof — the highest point in the scene.
    const shortfall = Math.max(0, REFERENCE_HEIGHT - height) / REFERENCE_HEIGHT;
    cam.lookAt(CAMERA_TARGET[0], CAMERA_TARGET[1] + shortfall * 1.6, CAMERA_TARGET[2]);
    cam.updateProjectionMatrix();
  }, [camera, width, height]);

  return null;
}

// A procedural studio environment (baked once) gives glass and solar
// panels something to reflect and adds soft image-based fill light —
// no external HDR asset required.
//
// Scaled by the phase rather than rebuilt for it. Every intensity is one
// multiplier off the daylight rig, so night dims the reflections instead of
// recolouring them: what the glass and the solar array reflect at 3am is a
// dark sky, which is a much weaker version of the same thing, not a different
// thing. `frames={1}` still bakes it once — the key is that `scale` changes
// the KEY of the Environment component, remounting it, so the bake is redone
// when the phase changes and only then.
function StudioEnvironment({ scale }: { scale: number }) {
  return (
    <Environment key={scale} resolution={256} frames={1} background={false}>
      <Lightformer intensity={3 * scale} position={[0, 5, -3]} scale={[12, 8, 1]} color="#ffffff" />
      <Lightformer intensity={1.4 * scale} position={[5, 3, 4]} scale={[6, 6, 1]} color="#eaf1f8" />
      <Lightformer intensity={1 * scale} position={[-6, 2, 2]} scale={[6, 6, 1]} color="#f3f6fa" />
    </Environment>
  );
}

/**
 * The installation, in 3D.
 *
 * Takes a PowerFlowScene, NOT a FleetSummary — that is what lets the same
 * renderer serve the fleet overview and a single site page without a fork. See
 * lib/power-flow-model.ts for the input and for the direction rules, which are
 * shared with both 2D diagrams so no two surfaces can disagree about which way
 * power is moving.
 *
 * (The file is still called fleet-3d-power-flow.tsx. The name is historical
 * and deliberately not changed: it is the dynamic-import specifier, written
 * out literally in TWO places that must stay in step — see the note in
 * fleet-power-flow-view.tsx — and it is referenced by a dozen comments across
 * scene/. Renaming buys accuracy in one place and churn in fourteen.)
 */
export function PowerFlowScene3D({ scene, className }: { scene: PowerFlowScene; className?: string }) {
  const { solar, load, grid, battery, soc, caption } = scene;

  // Nullable throughout: a site that does not report a channel must render an
  // absent leg, not a zero one. formatPower renders null as an em dash.
  const solarW = solar.valueW;
  const loadW = load.valueW;
  const gridW = grid.valueW;
  const batteryW = battery.valueW ?? 0;
  const maxWatts = Math.max(solarW ?? 0, loadW ?? 0, Math.abs(gridW ?? 0), Math.abs(batteryW), 1000);

  const containerRef = useRef<HTMLDivElement>(null);
  const renderActive = useRenderActive(containerRef);

  // Day, dusk or night at the installations — see the note above ACCENTS.
  const phase = useTimeOfDay();
  const lighting: SceneLighting = SCENE_LIGHTING[phase];
  const ACCENTS = lighting.accents;

  // Ambient occlusion is the single biggest "solid object" cue and the main
  // thing separating this from the reference render — but it is also the most
  // expensive thing in the scene. Enabled only where WebGL2 exists, and
  // withdrawn if the device turns out not to keep up (see PerformanceMonitor
  // below). Once withdrawn it stays off: re-enabling on recovery would make
  // the panel oscillate between two visibly different looks.
  const tier = useWebGLTier();
  const [gpuStruggling, setGpuStruggling] = useState(false);
  const aoEnabled = tier === "full" && !gpuStruggling;
  const handleDecline = useCallback(() => setGpuStruggling(true), []);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Optional corner caption — the fleet's "13/20 sites online". Null on a
          site page, whose name and status are already in the page header.
          Inked against the studio background, not the app theme:
          `text-foreground` here rendered white-on-white in dark mode.

          Bottom left, not top left. The callouts all resolve onto a shared
          baseline near the top of the panel, and once the battery moved into
          the undercroft its label landed straight on top of this counter —
          two unrelated numbers overprinting each other. The bottom-left
          corner is the only one still free; the model credit holds the
          bottom right. */}
      {caption && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10">
          <div className="font-mono text-lg font-semibold tabular-nums" style={{ color: lighting.ink.strong }}>
            {caption.value}
            {caption.muted && <span style={{ color: lighting.ink.muted }}>{caption.muted}</span>}
          </div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: lighting.ink.muted }}>
            {caption.label}
          </div>
        </div>
      )}

      {/* Attribution for any bundled model that requires it. MODEL_CREDITS is
          empty today — the scene is entirely procedural — so this renders
          nothing at all.

          It is deliberately left wired up rather than deleted. The licence
          rule it enforces is that credit must appear wherever the work
          appears, and the failure mode is someone dropping a CC BY asset into
          public/models later and shipping it uncredited. With this here,
          adding the entry to model-credits.ts is all that is needed and the
          credit reappears on the render by itself. */}
      <div
        className="pointer-events-none absolute bottom-1.5 right-2 z-10 text-[9px] leading-tight"
        style={{ color: lighting.ink.muted, opacity: 0.75 }}
      >
        {MODEL_CREDITS.map((credit) => (
          <div key={credit.file}>
            {credit.title} by {credit.author} · {credit.licence}
          </div>
        ))}
      </div>

      <Canvas
        shadows="soft"
        orthographic
        camera={{ position: CAMERA_POSITION, zoom: CAMERA_ZOOM, near: 0.1, far: 60 }}
        dpr={[1, 1.75]}
        // NeutralToneMapping (Khronos PBR Neutral), not r3f's ACES default.
        // ACES is a film curve: it rolls the top end off toward grey, which
        // on a scene that is almost entirely white plaster desaturates the
        // whole building and is a large part of why it read as "flat/drawn"
        // rather than as lit white surfaces. Neutral was designed for exactly
        // this case — product and clay renders — and preserves white as white
        // while still compressing highlights.
        gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1.08 }}
        // Stop driving rAF when the panel is off-screen or the tab is hidden.
        // Up to twelve useFrame callbacks run here per frame, four of which
        // write layout-affecting styles on the HTML callout overlays, and
        // none of that is worth doing for a panel nobody is looking at.
        frameloop={renderActive ? "always" : "never"}
      >
        <ResponsiveCamera />
        <color attach="background" args={[lighting.background]} />
        <GradientBackdrop lighting={lighting} />
        {/* Mounted only at night, unlike the security lighting, which stays in
            the scene unlit. A lamp post is part of the site whether or not it
            is switched on; stars are not there in daylight at all. */}
        {lighting.stars && <NightSky />}

        {/* The rig. Every value comes from SCENE_LIGHTING for the current
            phase — see that table for the reasoning behind each set.

            The daylight key is deliberately weak and its shadow very soft: the
            original rig threw long, hard, dark shadows (the carport cast a
            grey trapezoid over the whole lower-right quadrant), which is the
            opposite of how an architectural render grounds a building. Ambient
            and hemisphere carry more of the load, and the ContactShadows pass
            below does the grounding.

            The shadow CAMERA and the softness are phase-independent on
            purpose. They describe the quality of the shadow map, not the
            weather, and re-tuning them per phase would mean three sets of
            bias values to keep free of acne rather than one. */}
        <ambientLight intensity={lighting.ambientIntensity} color={lighting.ambientColor} />
        <hemisphereLight
          color={lighting.hemisphereSky}
          groundColor={lighting.hemisphereGround}
          intensity={lighting.hemisphereIntensity}
        />
        <directionalLight
          position={lighting.keyPosition}
          intensity={lighting.keyIntensity}
          color={lighting.keyColor}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-radius={14}
          shadow-blurSamples={24}
          shadow-bias={-0.0002}
        >
          <orthographicCamera attach="shadow-camera" args={[-9, 9, 9, -9, 0.1, 30]} />
        </directionalLight>

        <StudioEnvironment scale={lighting.environmentIntensity} />

        {/* Faint directional cast shadow for direction, plus real contact
            occlusion for grounding.

            The three hand-painted radial-gradient blobs this replaces were
            ellipses on the floor: they did not know the shape of what was
            above them, so the car, the battery cabinet and an 82-member
            lattice tower all cast the same soft oval. Drei's ContactShadows
            renders the scene from below into a blurred depth pass, so each
            object's actual silhouette darkens the floor beneath it — the
            single clearest "solid object sitting on a surface" cue, and one
            of the main things separating the reference render from ours.

            frames={1} bakes it once instead of every frame. The building
            never moves, so re-rendering that pass 60x a second is pure cost —
            which matters on the wall display's TV browser. */}
        {/* Both were tuned against a near-white floor, and the compound put a
            mid-green one under them. Left alone the building sat in a heavy
            blue-grey bruise: a shadow that reads as soft on #eef1f5 reads as
            mud on grass, because it is darkening a surface that already
            carries much more of the value range. Opacity comes down and the
            colour loses its blue — a shadow on a green surface is not a cool
            grey. ShadowFloor keeps its own opacity: it only shows out in the
            faded region where the ground really is still near-white. */}
        <ShadowFloor opacity={lighting.shadowFloorOpacity} />
        {/* Lifted clear of the paving. The slabs top out at 0.022 and this
            plane has to stay above everything it darkens, or the drive and
            apron punch through their own contact shadow. */}
        <ContactShadows
          position={[0, 0.026, 0]}
          // Covers +/- scale/2, which reaches every caster: the pylon at
          // x = 2.7 and the lamp post at x = -3.6. Was briefly 16 to take in a
          // tree at x = 6.3, at the cost of spreading the same 1024 map over a
          // 50% wider area; with the trees gone that resolution goes back into
          // the building, which is the only thing whose contact edge is close
          // enough to the camera to read.
          scale={13}
          far={3.6}
          blur={2.4}
          opacity={lighting.contactShadowOpacity}
          resolution={1024}
          frames={1}
          color={lighting.contactShadowColor}
        />

        {/* The site the house stands in — lawn, drive and planting. Rendered
            before the building so its opaque paving is laid down first; see
            the long note in scene/compound.tsx for why the lawn is a finite
            plot that fades out rather than a ground plane. */}
        {/* Security lighting needs BOTH conditions, and the second one was
            missing: it was driven by the clock alone, so at night a site
            reporting zero load still lit its compound. A security lamp is a
            load. If the house is drawing nothing, the lamps are not on either,
            and showing them lit contradicts the very reading the scene exists
            to display — the same lie as drawing an unreported channel as zero.

            Time of day still gates it, because a lamp that is off in daylight
            is off for a reason that has nothing to do with the inverter. */}
        <Compound securityLights={lighting.securityLights && load.active} />

        {/* The living-room television is lit whenever the fleet draws load,
            using the same threshold as the Load flow edge so the screen and
            the animated conduit can never disagree. */}
        <House loadActive={load.active} />
        <BatteryPack accentColor={ACCENTS.battery} soc={soc} />
        <GridPylon />

        {/* Conduit runs. All four terminate on the inverter, which is what
            makes the diagram truthful — see the routing block above. */}
        <PowerFlowEdge3D
          points={SOLAR_ROUTE}
          active={solar.active}
          reverse={solar.reverse}
          speed={scalePowerFlowSpeed(solarW ?? 0, maxWatts)}
          particleCount={2}
          conduitColor={lighting.ink.conduit}
          color={ACCENTS.solar}
        />
        <PowerFlowEdge3D
          points={GRID_ROUTE}
          active={grid.active}
          // Authored pylon->inverter, so non-reversed = importing; exporting
          // (gridW < 0) runs the other way.
          reverse={grid.reverse}
          speed={scalePowerFlowSpeed(gridW ?? 0, maxWatts)}
          particleCount={2}
          conduitColor={lighting.ink.conduit}
          color={ACCENTS.grid}
        />
        <PowerFlowEdge3D
          points={BATTERY_ROUTE}
          active={battery.active}
          // Declared battery->hub, so non-reversed = discharge; charging
          // (batteryW >= 0) is the reversed (hub->battery) case.
          reverse={battery.reverse}
          speed={scalePowerFlowSpeed(batteryW, maxWatts)}
          particleCount={2}
          conduitColor={lighting.ink.conduit}
          color={ACCENTS.battery}
        />
        <PowerFlowEdge3D
          points={LOAD_ROUTE}
          active={load.active}
          reverse={load.reverse}
          speed={scalePowerFlowSpeed(loadW ?? 0, maxWatts)}
          particleCount={2}
          conduitColor={lighting.ink.conduit}
          color={ACCENTS.load}
        />

        {/* Dashed-line callouts: a straight leader from the real object up
            to a label near the top of the frame (sky), or down to one near
            the bottom (ground strip), rather than a text block hovering
            beside the object itself — see the note on CALLOUT_LEADER
            above for why this replaced the ground-plate approach. */}
        <PowerFlowCallout3D
          anchor={SOLAR_PANEL_ANCHOR_W}
          label="Solar"
          value={formatPower(solarW)}
          color={ACCENTS.solar}
          ink={lighting.ink}
          placement="top"
          leaderLength={CALLOUT_LEADER}
        />
        <PowerFlowCallout3D
          anchor={PYLON_ANCHOR}
          label="Grid"
          value={formatPower(gridW == null ? null : Math.abs(gridW))}
          sublabel={grid.note ?? undefined}
          color={ACCENTS.grid}
          ink={lighting.ink}
          placement="top"
          leaderLength={CALLOUT_LEADER}
        />
        <PowerFlowCallout3D
          anchor={HOUSE_LOAD_ANCHOR_W}
          label="Load"
          value={formatPower(loadW)}
          color={ACCENTS.load}
          ink={lighting.ink}
          placement="top"
          leaderLength={CALLOUT_LEADER}
        />
        <PowerFlowCallout3D
          anchor={BATTERY_ANCHOR}
          label="Battery"
          value={formatPercent(soc)}
          sublabel={
            battery.valueW == null
              ? "flow not reported"
              : `${battery.note ?? "idle"} ${formatPower(Math.abs(battery.valueW))}`
          }
          color={ACCENTS.battery}
          ink={lighting.ink}
          placement="bottom"
          leaderLength={BATTERY_LEADER}
        />

        {/* Withdraws the AO pass if this device cannot sustain a reasonable
            frame rate. WebGL2 support is a necessary condition for effects,
            not a sufficient one — a TV browser can advertise WebGL2 and still
            crawl — so capability is checked up front and actual measured
            performance is what decides whether the effect stays. */}
        {/* Gated on renderActive as well as tier, so it remounts with fresh
            sampling state every time the loop resumes. Left mounted across a
            pause it would measure the first frame after frameloop flips back
            from "never" — a delta covering however long the panel sat
            off-screen — and read a scroll as a GPU that cannot cope. */}
        {tier === "full" && renderActive && <PerformanceMonitor onDecline={handleDecline} />}

        {/* Ambient occlusion — the contact darkening that makes the massing
            read as solid. Its chunk is fetched only once we know this device
            is on the "full" tier, so the scene's first frame never waits on
            it; `fallback={null}` means the un-shaded scene renders in the
            meantime and the shading resolves into it. Suspense inside a
            Canvas is handled by the r3f reconciler, not by the DOM one. */}
        {aoEnabled && (
          <Suspense fallback={null}>
            <AmbientOcclusion intensity={lighting.aoIntensity} />
          </Suspense>
        )}
      </Canvas>
    </div>
  );
}
