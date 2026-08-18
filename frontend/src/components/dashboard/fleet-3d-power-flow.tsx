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
  GRID_DROP_X,
  House,
  HOUSE_HUB_ANCHOR,
  HOUSE_LOAD_ANCHOR,
  HUB_LEFT_X,
  HUB_RIGHT_X,
  HUB_TOP_Y,
  FACADE_Z,
  ROOF_FRONT_Z,
  SIDE_X,
  STOREY_LINE_Y,
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
import { cn } from "@/lib/utils";

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
// FOUR SERVICES, FOUR FACES. Each run approaches the inverter from its own
// side, which is what keeps them legible:
//
//   solar   -> TOP    (down from the roof, on the left)
//   grid    -> RIGHT  (in off the roof run, on the right)
//   battery -> LEFT   (in from the undercroft cabinet)
//   load    -> BOTTOM (out and along to the television)
//
// Solar and grid previously ran the other way round: the grid crossed the
// whole roof to drop at x = -1.05, LEFT of the solar drop at x = -0.3, then
// doubled back rightward into the hub while solar came leftward into the same
// hub. The two runs crossed twice — once where the roof run passed the solar
// take-off, once on the approach — which is what read as criss-crossing. Now
// the grid's roof run stops at GRID_DROP_X and never travels further left,
// and the solar drop is the only thing left of it. Their X ranges no longer
// overlap at all, so no camera angle can make them cross.
//
// The facade's front face is z = 1.025 and the eaves overhang to
// ROOF_FRONT_Z. Each service gets its own shallow plane proud of the wall:
// solar and grid must also clear the eaves, since both drop past them.
const Z_SOLAR = ROOF_FRONT_Z + 0.035;
// The grid no longer comes over the roof, so it no longer has to clear the
// eaves — it sits proud of the FACADE instead, which is 0.08 shallower. Deep
// enough to stand clear of the shadow-line reveal at the storey line (whose
// front face is at FACADE_Z + 0.015) without floating off the wall.
const Z_GRID = FACADE_Z + 0.075;
/** The grid's plane on the right END wall, mirroring Z_GRID's offset off the front. */
const X_GRID_SIDE = SIDE_X + 0.05;
/**
 * Where the service drop lands on the side wall, and the level it lands at.
 *
 * Kept BEHIND the front plane (negative Z) on purpose — that is the whole
 * point of the side route, see GRID_ROUTE. Set at the upper storey rather than
 * at the storey line so the span from the tower stays a shallow ~30° descent
 * instead of the ~50° plunge it becomes if the cable has to reach all the way
 * down to the slab in one go.
 */
const SIDE_LANDING_Z = -0.55;
const SIDE_LANDING_Y = 2.15;
const Z_BATTERY = 1.09;
const Z_LOAD = 1.05;
/** Where a run meets the inverter box (0.22 x 0.32, centred on the hub). */
const HUB_FACE_Z = 1.1;
/** Hub centre height — the level the two side entries come in at. */
const HUB_Y = HOUSE_HUB_ANCHOR[1];

// Off the panels, forward over the eaves, straight down into the top of the
// inverter. Three waypoints and a single bend — the solar leg is now the
// simplest run in the scene, and the whole of it sits left of the grid.
const SOLAR_ROUTE = [
  SOLAR_PANEL_ANCHOR,
  [SOLAR_DROP_X, SOLAR_PANEL_ANCHOR[1], Z_SOLAR],
  [SOLAR_DROP_X, HUB_TOP_Y - 0.03, Z_SOLAR],
] as const;

// Out of the cabinet under the undercroft, forward clear of it, down to hub
// height and straight in to the inverter's left face. Entirely within
// x < -1.4, so it never approaches the glazing the old run crossed.
const BATTERY_ROUTE = [
  BATTERY_ANCHOR,
  [BATTERY_ANCHOR[0], BATTERY_ANCHOR[1], Z_BATTERY],
  [BATTERY_ANCHOR[0], HUB_Y, Z_BATTERY],
  [HUB_LEFT_X, HUB_Y, HUB_FACE_Z],
] as const;

// Overhead service drop from the pylon, landing at the building's front-right
// corner and running left along the STOREY LINE — the floor line between the
// ground and first storeys — into the inverter's right face.
//
// It used to lie along the roof, which solved the right problem the wrong way.
// The problem was that carried on the facade at an arbitrary height it was a
// long line suspended in front of the building with nothing behind it; the
// roof at least gave it a surface. But the roof is the top edge of the
// composition, so the run drew a second horizontal line above the building
// and then had to climb back down the full storey height to reach the
// inverter — a long detour past everything.
//
// The storey line is a real surface too, and a better one: see STOREY_LINE_Y
// in scene/house.tsx for why it is continuous across both wings (reveal band
// on the closed wing, exposed slab edge across the cutaway) and why it is the
// one horizontal band on the facade that crosses no glazing. The run is now
// attached for its whole length, sits in the middle of the elevation instead
// of on top of it, and arrives at the inverter from one storey up rather than
// three.
//
// IT COMES DOWN THE SIDE, NOT ACROSS THE FRONT. This is the constraint the
// route exists to satisfy and it is easy to lose.
//
// The pylon stands BEHIND the building (z = -1.25) and the inverter is on the
// FRONT facade. An earlier version landed the span directly on the front plane
// at z = +1.10, which meant the cable had to get from behind the house to in
// front of it in one free span — and the only path is straight across the open
// cutaway. The result was a long diagonal drawn right through the bedroom: the
// single most obtrusive line in the render, crossing the one part of the scene
// that is supposed to be showing furniture.
//
// So the cable now lands on the right END wall, at a z that is still behind
// the front plane, and every point of the span stays right of x = 1.7. It
// therefore cannot cross the building's volume at all. From the bracket it
// runs down the side wall, forward along it to the front-right corner, and
// only then turns onto the facade — where it picks up the storey line as
// before.
//
// The first leg is the only one in the scene that moves on all three axes, and
// that is correct rather than sloppy: it is a free span between a tower and a
// building, which is exactly what an overhead service drop is. Every leg after
// it, once the cable is fixed to the structure, is orthogonal.
//
// The side legs sit 0.05 proud of the end wall, mirroring the 0.075 the facade
// legs stand off the front, so the run keeps a constant apparent gap from the
// building as it turns the corner.
const GRID_ROUTE = [
  PYLON_ANCHOR,
  // Bracket on the side wall, upper storey, behind the front plane.
  [X_GRID_SIDE, SIDE_LANDING_Y, SIDE_LANDING_Z],
  // Down the side wall to the storey line.
  [X_GRID_SIDE, STOREY_LINE_Y, SIDE_LANDING_Z],
  // Forward along the side to the front-right corner.
  [X_GRID_SIDE, STOREY_LINE_Y, Z_GRID],
  // Round the corner and along the storey line to the service bay.
  [GRID_DROP_X, STOREY_LINE_Y, Z_GRID],
  // Down to inverter height, then in to its right face.
  [GRID_DROP_X, HUB_Y, Z_GRID],
  [HUB_RIGHT_X, HUB_Y, HUB_FACE_Z],
] as const;

// Out of the bottom of the inverter, down to skirting level, along the facade
// UNDER the ground-floor window (its sill is at y ~ 0.31 — run any higher and
// the conduit crosses the glass), in through the open corner, then up the
// partition to the television.
const LOAD_ROUTE = [
  HOUSE_HUB_ANCHOR,
  [HOUSE_HUB_ANCHOR[0], 0.25, Z_LOAD],
  [HOUSE_LOAD_ANCHOR[0], 0.25, Z_LOAD],
  [HOUSE_LOAD_ANCHOR[0], 0.25, HOUSE_LOAD_ANCHOR[2]],
  HOUSE_LOAD_ANCHOR,
] as const;

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

        {/* Dashed-line callouts. Leader lengths are computed per frame from
            each anchor's projected position, so all four labels land on one
            screen baseline regardless of camera framing — no per-callout
            pixel tuning here. */}
        {/* offsetX values de-collide the four labels on the shared baseline.
            The battery's "charging 33.1 kW" sublabel is the widest block of
            the four, so left to themselves they overlap.

            Solar and Battery need much more separation than they used to:
            moving the inverter into the left service bay took the solar
            anchor from x = -0.3 to x = -1.36, so it now sits only ~0.56 world
            units from the battery at -1.92 instead of ~1.6. They are pushed
            apart rather than nudged. These are screen-space pixels against a
            zoom that varies with panel size, so they are the one thing here
            most likely to want a nudge once it is seen at real wall scale. */}
        <PowerFlowCallout3D anchor={SOLAR_PANEL_ANCHOR} label="Solar" value={formatPower(solarW)} color={ACCENTS.solar} ink={lighting.ink} offsetX={30} />
        <PowerFlowCallout3D
          anchor={PYLON_ANCHOR}
          label="Grid"
          value={formatPower(gridW == null ? null : Math.abs(gridW))}
          sublabel={grid.note ?? undefined}
          color={ACCENTS.grid}
          ink={lighting.ink}
        />
        <PowerFlowCallout3D
          anchor={[HOUSE_LOAD_ANCHOR[0], HOUSE_LOAD_ANCHOR[1] + 0.2, HOUSE_LOAD_ANCHOR[2]]}
          label="Load"
          value={formatPower(loadW)}
          color={ACCENTS.load}
          ink={lighting.ink}
          offsetX={46}
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
          offsetX={-70}
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
