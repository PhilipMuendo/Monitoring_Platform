"use client";

import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeutralToneMapping, type OrthographicCamera as ThreeOrthographicCamera } from "three";

import { BatteryPack, BATTERY_ANCHOR } from "@/components/dashboard/scene/battery-pack";
import { Car } from "@/components/dashboard/scene/car";
import { GltfModel } from "@/components/dashboard/scene/gltf-model";
import { GradientBackdrop, ShadowFloor } from "@/components/dashboard/scene/ground";
import { MODEL_CREDITS } from "@/components/dashboard/scene/model-credits";
import { GridPylon, PYLON_ANCHOR } from "@/components/dashboard/scene/grid-pylon";
import {
  CARPORT_POSITION,
  House,
  HOUSE_HUB_ANCHOR,
  HOUSE_LOAD_ANCHOR,
  SOLAR_PANEL_ANCHOR,
} from "@/components/dashboard/scene/house";
import { PowerFlowCallout3D } from "@/components/dashboard/scene/power-flow-callout-3d";
import { PowerFlowEdge3D } from "@/components/dashboard/scene/power-flow-edge-3d";
import { useRenderActive } from "@/hooks/use-render-active";
import { useWebGLTier } from "@/hooks/use-webgl-support";
import { formatPercent, formatPower } from "@/lib/format";
import { POWER_FLOW_COLORS, STUDIO, STUDIO_INK } from "@/lib/power-flow-colors";
import { POWER_FLOW_THRESHOLD_W, scalePowerFlowSpeed } from "@/lib/power-flow-scale";
import { cn } from "@/lib/utils";
import type { FleetSummary } from "@/lib/types";

const CAMERA_POSITION: [number, number, number] = [7.6, 5.2, 8.2];
const CAMERA_TARGET: [number, number, number] = [0.35, 1.25, 0];
// Starting zoom only — ResponsiveCamera recomputes this from the canvas
// dimensions on mount and on every resize.
const CAMERA_ZOOM = 62;
/** Canvas height the fixed camera framing was tuned against (the dashboard panel). */
const REFERENCE_HEIGHT = 380;

// Orthographic zoom is pixels-per-world-unit, so it has to scale with the
// canvas: at a fixed zoom a bigger panel just adds empty margin around a
// same-sized house, which is the opposite of the "make the 3D view bigger"
// ask. Fitted against BOTH axes and min'd, because the old height-only law
// was safe only while the panel stayed wider than it was tall — on a narrow
// one it ran the pylon and battery off the left and right edges, which are
// exactly the things the Grid and Battery callouts point at.
//
// Vertical: unchanged. 380 px x 0.163 reproduces the zoom of 62 the original
// framing was hand-tuned to, so a panel of the old height frames as before.
const ZOOM_PER_PX_HEIGHT = 0.163;
// Horizontal: derived, not guessed. Projecting the scene's world bounding box
// (car at x=-3.55 through pylon at x=+2.9, roof at y=3.1) through this exact
// camera gives an on-screen extent of 8.50 world units, so 1 / (8.50 x 1.04
// margin) is the zoom at which the scene exactly spans the panel width. An
// earlier guess of 0.105 left the view width-bound at every realistic size,
// which threw the taller panel away entirely — the scene came out *smaller*
// than before despite the card growing.
// Re-derived after the car moved into the undercroft. That single change
// collapsed the projected scene from 8.22 x 5.67 world units to 6.79 x 5.16 —
// the car had been sitting forward AND to the left of everything else, so it
// was setting both the width and the depth the camera had to cover. Fitting a
// smaller box means a larger zoom, which is why the building ends up roughly
// 2.4x its original on-screen size for no change in panel size at all.
const ZOOM_PER_PX_WIDTH = 0.1417;
const ZOOM_MIN = 30;
const ZOOM_MAX = 170;

// Always render in the bright studio palette — the reference is a clean,
// well-lit architectural render regardless of app theme, and the user
// wants it light. Only the semantic accent colors come from the tokens.
const ACCENTS = POWER_FLOW_COLORS.light;

// Bezier control points for the four conduits.
//
// These are authored explicitly rather than derived from the midpoint of
// their endpoints. A midpoint control puts the curve's belly inside the
// building volume — the grid run from the pylon speared straight through
// the sectioned bedroom, and the solar run from the roof to the wall-
// mounted inverter disappeared inside the massing entirely. Pushing every
// control well forward of the facade (Z ≳ 1.7, against a front wall at
// Z = 1.025) keeps all four conduits in clear air in front of the house,
// which is also how the reference render routes them.
// ---------------------------------------------------------------------------
// Conduit routing
//
// Every service converges on the inverter, because that is what an inverter
// is: the point where PV, battery, grid and house loads actually meet. The
// grid leg used to stop at a service head on the right-hand gable and never
// reach it, which left the diagram claiming the utility feed connects to
// nothing.
//
// Runs are authored as orthogonal waypoints — vertical drops, horizontal
// runs, right-angle turns — rather than as smooth curves through open air.
// See the long note in scene/power-flow-edge-3d.tsx for why.
//
// The facade's front face is z = 1.025. Each service is given its own shallow
// plane a few centimetres proud of it so that where two runs cross they pass
// cleanly in front of/behind each other instead of intersecting — which is
// also how a real wall with several services on it looks.
const Z_SOLAR = 1.13;
const Z_BATTERY = 1.09;
const Z_GRID = 1.17;
const Z_LOAD = 1.05;
/** Where a run meets the inverter box (0.22 x 0.32, centred on the hub). */
const HUB_FACE_Z = 1.1;

// The roof slab's top surface, which the grid run lies along. The roof group
// sits at y = WALL_TOP + SLAB_T = 2.61, z = 0.125, pitched 0.16 rad about X,
// with the slab's top face 0.1 above its own origin — so a point at local
// depth zl lands at world y = 2.709 - 0.159*zl, z = 0.141 + 0.987*zl. The
// strip in front of the array (local zl ~ 0.85) therefore sits at roughly
// y 2.57, z 1.00, and the constants below ride just clear of it.
const ROOF_RUN_Y = 2.6;
const ROOF_RUN_Z = 0.98;

// Off the array, forward over the roof edge, then straight down the facade
// and across into the top of the inverter.
const SOLAR_ROUTE = [
  SOLAR_PANEL_ANCHOR,
  [-0.3, 2.66, 1.12],
  [-0.3, 2.42, Z_SOLAR],
  [-0.3, 1.12, Z_SOLAR],
  [-0.72, 1.12, Z_SOLAR],
  [-0.72, 1.02, HUB_FACE_Z],
] as const;

// Out of the cabinet under the undercroft, along the wall, into the side of
// the inverter. Dropped to y = 1.05 for the horizontal leg so it does not sit
// at the same height as the solar run and read as one broken line.
const BATTERY_ROUTE = [
  BATTERY_ANCHOR,
  [-1.92, 1.05, Z_BATTERY],
  [-0.95, 1.05, Z_BATTERY],
  [-0.95, 0.92, Z_BATTERY],
  [-0.72, 0.92, HUB_FACE_Z],
] as const;

// Overhead service drop from the pylon, landing on the ROOF and running along
// it, then over the front edge and down the wall into the inverter.
//
// Lying on the roof is the point. Carried at y = 2.45 on the facade plane it
// was a long line suspended in front of the building, crossing the whole
// composition with nothing behind it — which is what made it read as one huge
// stroke rather than as part of the house. Sosen runs theirs along the flat
// roof, where it is visually attached to a surface and stops competing with
// the building. ROOF_RUN_Y/Z put it on the strip of deck in front of the
// array, and the pylon has been pulled in from x=2.9 to shorten the free span.
//
// The first leg is the only one in the scene that moves on all three axes,
// and that is correct rather than sloppy: it is a free span between a pole
// and a building, which is exactly what an overhead service drop is. Every
// leg after it, once the cable is fixed to the structure, is orthogonal.
//
// The head sits at x = 1.72, a whisker proud of the right wall at 1.7. It was
// briefly at 2.1 — beyond the building entirely — which put the corner where
// the span "lands" in open air with nothing to land on.
const GRID_ROUTE = [
  PYLON_ANCHOR,
  [1.72, ROOF_RUN_Y, ROOF_RUN_Z],
  [-1.05, ROOF_RUN_Y, ROOF_RUN_Z],
  [-1.05, 2.42, Z_GRID],
  [-1.05, 1.22, Z_GRID],
  [-0.8, 1.22, Z_GRID],
  [-0.8, 1.02, HUB_FACE_Z],
] as const;

// Out of the bottom of the inverter, down to skirting level, along the facade
// UNDER the ground-floor window (its sill is at y ~ 0.31 — run any higher and
// the conduit crosses the glass), in through the open corner, then up the
// partition to the television.
const LOAD_ROUTE = [
  HOUSE_HUB_ANCHOR,
  [-0.72, 0.25, Z_LOAD],
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
    // sitting at a fixed size inside it. Bound by whichever axis is tighter
    // so the house can never overflow horizontally — see the constants above.
    const fitted = Math.min(height * ZOOM_PER_PX_HEIGHT, width * ZOOM_PER_PX_WIDTH);
    // eslint-disable-next-line react-hooks/immutability
    cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitted));

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
function StudioEnvironment() {
  return (
    <Environment resolution={256} frames={1} background={false}>
      <Lightformer intensity={3} position={[0, 5, -3]} scale={[12, 8, 1]} color="#ffffff" />
      <Lightformer intensity={1.4} position={[5, 3, 4]} scale={[6, 6, 1]} color="#eaf1f8" />
      <Lightformer intensity={1} position={[-6, 2, 2]} scale={[6, 6, 1]} color="#f3f6fa" />
    </Environment>
  );
}

export function Fleet3DPowerFlow({ summary, className }: { summary: FleetSummary; className?: string }) {
  const solarW = summary.total_power_w;
  const loadW = summary.total_load_w;
  const gridW = summary.total_grid_w;
  const batteryW = summary.total_battery_w;
  const maxWatts = Math.max(solarW, loadW, Math.abs(gridW), Math.abs(batteryW), 1000);

  const containerRef = useRef<HTMLDivElement>(null);
  const renderActive = useRenderActive(containerRef);

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
      {/* Fleet count as a low-profile corner overlay rather than a badge over
          the house. Inked against the studio background, not the app theme —
          `text-foreground` here rendered white-on-white in dark mode. */}
      {/* Bottom left, not top left. The callouts all resolve onto a shared
          baseline near the top of the panel, and once the battery moved into
          the undercroft its label landed straight on top of this counter —
          two unrelated numbers overprinting each other. The bottom-left
          corner is the only one still free; the model credit holds the
          bottom right. */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10">
        <div className="font-mono text-lg font-semibold tabular-nums" style={{ color: STUDIO_INK.strong }}>
          {summary.online_sites}
          <span style={{ color: STUDIO_INK.muted }}>/{summary.total_sites}</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide" style={{ color: STUDIO_INK.muted }}>
          sites online
        </div>
      </div>

      {/* CC BY attribution for the bundled car model. Small and muted, but
          deliberately on the render itself rather than tucked away in an
          about page: the licence requires credit wherever the work appears,
          and this is where it appears. Removing this without also removing
          public/models/car.glb puts the deployment in breach. */}
      <div
        className="pointer-events-none absolute bottom-1.5 right-2 z-10 text-[9px] leading-tight"
        style={{ color: STUDIO_INK.muted, opacity: 0.75 }}
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
        <color attach="background" args={[STUDIO.background]} />
        <GradientBackdrop />

        {/* Bright studio lighting. The key light is deliberately weaker than
            it was and its shadow much softer: the old rig threw long, hard,
            dark shadows (the carport cast a grey trapezoid over the whole
            lower-right quadrant) which is the opposite of how an
            architectural render grounds a building. Ambient and hemisphere
            carry more of the load now, and the ContactShadows pass below
            does the grounding. */}
        <ambientLight intensity={0.72} />
        <hemisphereLight color="#ffffff" groundColor="#dfe4ec" intensity={0.62} />
        <directionalLight
          position={[-5.5, 9, 5]}
          intensity={0.95}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-radius={14}
          shadow-blurSamples={24}
          shadow-bias={-0.0002}
        >
          <orthographicCamera attach="shadow-camera" args={[-9, 9, 9, -9, 0.1, 30]} />
        </directionalLight>

        <StudioEnvironment />

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
        <ShadowFloor opacity={0.1} />
        <ContactShadows
          position={[0, 0.006, 0]}
          scale={13}
          far={3.6}
          blur={2.4}
          opacity={0.52}
          resolution={1024}
          frames={1}
          color="#28303c"
        />

        {/* The living-room television is lit whenever the fleet draws load,
            using the same threshold as the Load flow edge so the screen and
            the animated conduit can never disagree. */}
        <House loadActive={loadW > POWER_FLOW_THRESHOLD_W} />
        <BatteryPack accentColor={ACCENTS.battery} soc={summary.avg_soc} />
        {/* Parked inside the undercroft rather than on open ground to the
            left. That bay is part of the building footprint, so the car no
            longer contributes to the scene's width — it was previously the
            leftmost object and, with the pylon, set the span the camera had
            to fit, scaling the house down to suit. Position comes from the
            house so the two cannot drift apart.

            A real model now, not the extruded profile: an actual vehicle is
            what sells the scene as a render rather than a diagram, and it is
            the one object in the reference images that unmistakably reads as
            real. The procedural Car stays as the Suspense fallback so the bay
            is never empty while 4 MB streams in — and so the scene still
            works if the asset is ever removed.

            targetHeight 0.42 world units: the house body is 3.4 across for a
            building of roughly 12 m, putting a scene unit near 3.5 m, so a
            ~1.5 m car lands about here. GltfModel rescales whatever it is
            given to this, so the source export's own scale is irrelevant.

            Licensed CC BY 4.0 — attribution is required and lives in
            public/models/ATTRIBUTION.md and scene/model-credits.ts. Do not
            ship this asset without that credit rendered somewhere visible. */}
        <GltfModel
          url="/models/car.glb"
          targetHeight={0.42}
          position={CARPORT_POSITION}
          fallback={<Car position={CARPORT_POSITION} rotation={Math.PI * 0.5} length={1.15} />}
        />
        <GridPylon />

        {/* Conduit runs. All four terminate on the inverter, which is what
            makes the diagram truthful — see the routing block above. */}
        <PowerFlowEdge3D
          points={SOLAR_ROUTE}
          active={solarW > POWER_FLOW_THRESHOLD_W}
          reverse={false}
          speed={scalePowerFlowSpeed(solarW, maxWatts)}
          particleCount={2}
          color={ACCENTS.solar}
        />
        <PowerFlowEdge3D
          points={GRID_ROUTE}
          active={Math.abs(gridW) > POWER_FLOW_THRESHOLD_W}
          // Authored pylon->inverter, so non-reversed = importing; exporting
          // (gridW < 0) runs the other way.
          reverse={gridW < 0}
          speed={scalePowerFlowSpeed(gridW, maxWatts)}
          particleCount={2}
          color={ACCENTS.grid}
        />
        <PowerFlowEdge3D
          points={BATTERY_ROUTE}
          active={Math.abs(batteryW) > POWER_FLOW_THRESHOLD_W}
          // Declared battery->hub, so non-reversed = discharge; charging
          // (batteryW >= 0) is the reversed (hub->battery) case.
          reverse={batteryW >= 0}
          speed={scalePowerFlowSpeed(batteryW, maxWatts)}
          particleCount={2}
          color={ACCENTS.battery}
        />
        <PowerFlowEdge3D
          points={LOAD_ROUTE}
          active={loadW > POWER_FLOW_THRESHOLD_W}
          reverse={false}
          speed={scalePowerFlowSpeed(loadW, maxWatts)}
          particleCount={2}
          color={ACCENTS.load}
        />

        {/* Dashed-line callouts. Leader lengths are computed per frame from
            each anchor's projected position, so all four labels land on one
            screen baseline regardless of camera framing — no per-callout
            pixel tuning here. */}
        {/* offsetX values de-collide the four labels on the shared baseline.
            Solar and Load anchor within ~0.6 world units of each other in
            screen X, and the battery's "charging 33.1 kW" sublabel is the
            widest block of the four, so left to themselves they overlap. */}
        <PowerFlowCallout3D anchor={SOLAR_PANEL_ANCHOR} label="Solar" value={formatPower(solarW)} color={ACCENTS.solar} offsetX={-34} />
        <PowerFlowCallout3D
          anchor={PYLON_ANCHOR}
          label="Grid"
          value={formatPower(Math.abs(gridW))}
          sublabel={gridW >= 0 ? "importing" : "exporting"}
          color={ACCENTS.grid}
        />
        <PowerFlowCallout3D
          anchor={[HOUSE_LOAD_ANCHOR[0], HOUSE_LOAD_ANCHOR[1] + 0.2, HOUSE_LOAD_ANCHOR[2]]}
          label="Load"
          value={formatPower(loadW)}
          color={ACCENTS.load}
          offsetX={46}
        />
        <PowerFlowCallout3D
          anchor={BATTERY_ANCHOR}
          label="Battery"
          value={formatPercent(summary.avg_soc)}
          sublabel={`${batteryW >= 0 ? "charging" : "discharging"} ${formatPower(Math.abs(batteryW))}`}
          color={ACCENTS.battery}
          offsetX={-30}
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

        {/* Ambient occlusion: the contact darkening in corners, under the
            roof overhang and beneath the furniture. This is the single
            largest remaining difference between a lit render and something
            that reads as a flat drawing — plain white surfaces only look
            solid once their creases are shaded.

            halfRes + depthAwareUpsampling computes AO at quarter the pixel
            count and upsamples along depth edges; at the size this panel
            renders that is visually indistinguishable and roughly a third of
            the cost. multisampling is left on the composer rather than
            adding a separate SMAA pass — WebGL2 gives MSAA on the render
            target for free, and that is one fewer full-screen pass. */}
        {aoEnabled && (
          <EffectComposer multisampling={4} enableNormalPass={false}>
            <N8AO
              aoRadius={0.28}
              distanceFalloff={0.8}
              intensity={2.6}
              quality="medium"
              halfRes
              depthAwareUpsampling
              color="#2a3242"
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}
