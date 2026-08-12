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
  GRID_DROP_X,
  House,
  HOUSE_HUB_ANCHOR,
  HOUSE_LOAD_ANCHOR,
  HUB_LEFT_X,
  HUB_RIGHT_X,
  HUB_TOP_Y,
  ROOF_FRONT_Z,
  ROOF_TOP_Y,
  SOLAR_DROP_X,
  SOLAR_PANEL_ANCHOR,
} from "@/components/dashboard/scene/house";
import { PowerFlowCallout3D } from "@/components/dashboard/scene/power-flow-callout-3d";
import { PowerFlowEdge3D } from "@/components/dashboard/scene/power-flow-edge-3d";
import { useRenderActive } from "@/hooks/use-render-active";
import { useWebGLTier } from "@/hooks/use-webgl-support";
import { formatPercent, formatPower } from "@/lib/format";
import { POWER_FLOW_COLORS, STUDIO, STUDIO_INK } from "@/lib/power-flow-colors";
import { batteryLeg, gridLeg, loadLeg, solarLeg } from "@/lib/power-flow-model";
import { scalePowerFlowSpeed } from "@/lib/power-flow-scale";
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
const Z_GRID = ROOF_FRONT_Z + 0.075;
const Z_BATTERY = 1.09;
const Z_LOAD = 1.05;
/** Where a run meets the inverter box (0.22 x 0.32, centred on the hub). */
const HUB_FACE_Z = 1.1;
/** Hub centre height — the level the two side entries come in at. */
const HUB_Y = HOUSE_HUB_ANCHOR[1];

// The strip of flat roof deck in front of the array that the grid run lies
// along. Now that the roof is flat these are two plain numbers rather than a
// point projected through a pitch rotation.
const ROOF_RUN_Y = ROOF_TOP_Y + 0.03;
const ROOF_RUN_Z = 0.92;

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

// Overhead service drop from the pylon, landing on the ROOF and running along
// it, then over the eaves and down the wall into the inverter's right face.
//
// Lying on the roof is the point. Carried on the facade plane it was a long
// line suspended in front of the building, crossing the whole composition with
// nothing behind it. On the roof it is visually attached to a surface and
// stops competing with the building.
//
// The first leg is the only one in the scene that moves on all three axes, and
// that is correct rather than sloppy: it is a free span between a tower and a
// building, which is exactly what an overhead service drop is. Every leg after
// it, once the cable is fixed to the structure, is orthogonal — and the tower
// is now tall enough (see grid-pylon.tsx) that the span descends the whole
// way instead of climbing up to the roof it feeds.
//
// The head sits at x = 1.72, a whisker proud of the right wall at 1.7. It was
// briefly at 2.1 — beyond the building entirely — which put the corner where
// the span "lands" in open air with nothing to land on.
const GRID_ROUTE = [
  PYLON_ANCHOR,
  [1.72, ROOF_RUN_Y, ROOF_RUN_Z],
  [GRID_DROP_X, ROOF_RUN_Y, ROOF_RUN_Z],
  [GRID_DROP_X, ROOF_RUN_Y, Z_GRID],
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
  // Same direction/null semantics as the 2D view — see lib/power-flow-model.
  // Sharing them is what stops the two views disagreeing about which way power
  // is going for the same summary.
  const solar = solarLeg(summary.total_power_w);
  const load = loadLeg(summary.total_load_w);
  const grid = gridLeg(summary.total_grid_w);
  const battery = batteryLeg(summary.total_battery_w);

  const solarW = summary.total_power_w;
  const loadW = summary.total_load_w;
  const gridW = summary.total_grid_w;
  const batteryW = battery.valueW ?? 0;
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
        <House loadActive={load.active} />
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
          active={solar.active}
          reverse={solar.reverse}
          speed={scalePowerFlowSpeed(solarW, maxWatts)}
          particleCount={2}
          color={ACCENTS.solar}
        />
        <PowerFlowEdge3D
          points={GRID_ROUTE}
          active={grid.active}
          // Authored pylon->inverter, so non-reversed = importing; exporting
          // (gridW < 0) runs the other way.
          reverse={grid.reverse}
          speed={scalePowerFlowSpeed(gridW, maxWatts)}
          particleCount={2}
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
          color={ACCENTS.battery}
        />
        <PowerFlowEdge3D
          points={LOAD_ROUTE}
          active={load.active}
          reverse={load.reverse}
          speed={scalePowerFlowSpeed(loadW, maxWatts)}
          particleCount={2}
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
        <PowerFlowCallout3D anchor={SOLAR_PANEL_ANCHOR} label="Solar" value={formatPower(solarW)} color={ACCENTS.solar} offsetX={30} />
        <PowerFlowCallout3D
          anchor={PYLON_ANCHOR}
          label="Grid"
          value={formatPower(Math.abs(gridW))}
          sublabel={grid.note ?? undefined}
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
          sublabel={
            battery.valueW == null
              ? "flow not reported"
              : `${battery.note ?? "idle"} ${formatPower(Math.abs(battery.valueW))}`
          }
          color={ACCENTS.battery}
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
