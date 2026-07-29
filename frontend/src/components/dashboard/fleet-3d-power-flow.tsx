"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { OrthographicCamera as ThreeOrthographicCamera } from "three";

import { BatteryPack, BATTERY_ANCHOR, BATTERY_POSITION } from "@/components/dashboard/scene/battery-pack";
import { Car } from "@/components/dashboard/scene/car";
import { ContactShadow, GradientBackdrop, ShadowFloor } from "@/components/dashboard/scene/ground";
import { GridPylon, PYLON_ANCHOR, PYLON_POSITION } from "@/components/dashboard/scene/grid-pylon";
import { House, HOUSE_HUB_ANCHOR, HOUSE_LOAD_ANCHOR, SOLAR_PANEL_ANCHOR } from "@/components/dashboard/scene/house";
import { PowerFlowCallout3D } from "@/components/dashboard/scene/power-flow-callout-3d";
import { PowerFlowEdge3D } from "@/components/dashboard/scene/power-flow-edge-3d";
import { formatPercent, formatPower } from "@/lib/format";
import { POWER_FLOW_COLORS, STUDIO, STUDIO_INK } from "@/lib/power-flow-colors";
import { POWER_FLOW_THRESHOLD_W, scalePowerFlowSpeed } from "@/lib/power-flow-scale";
import { cn } from "@/lib/utils";
import type { FleetSummary } from "@/lib/types";

const CAMERA_POSITION: [number, number, number] = [7.6, 5.2, 8.2];
const CAMERA_TARGET: [number, number, number] = [0.35, 1.25, 0];
// Raised from 48 now that the battery and pylon have been pulled in tight
// around the house. The old spread (battery at X=-2.9, pylon at X=3.5) had
// to be framed at a zoom that left the building occupying maybe a quarter
// of the panel width, with dead bands either side; the reference render
// fills roughly two-thirds of its frame with the building.
const CAMERA_ZOOM = 62;
/** Canvas height the fixed camera framing was tuned against (the dashboard panel). */
const REFERENCE_HEIGHT = 380;

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
const SOLAR_CONTROL: [number, number, number] = [-0.45, 2.75, 1.95];
const GRID_CONTROL: [number, number, number] = [1.45, 1.5, 2.15];
const BATTERY_CONTROL: [number, number, number] = [-1.5, 1.3, 1.75];
// Load now terminates on the television, deep inside the sectioned room, so
// this control arcs the run forward of the facade before it dives in
// through the open corner rather than tunnelling through the front wall.
const LOAD_CONTROL: [number, number, number] = [0.15, 1.5, 1.9];

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
  const height = size.height;

  useEffect(() => {
    const cam = camera as ThreeOrthographicCamera;

    // Zoom tracks canvas height rather than being pinned to CAMERA_ZOOM. The
    // dashed callouts extend well above the roofline, and at a fixed zoom a
    // shorter canvas (the wall display packs this panel into whatever the
    // screen leaves over) pushed the Solar and Load labels past the top edge,
    // where they were clipped. CAMERA_ZOOM stays the cap, so the dashboard's
    // taller panel is framed exactly as before.
    // eslint-disable-next-line react-hooks/immutability
    cam.zoom = Math.max(30, Math.min(CAMERA_ZOOM, height * 0.163));

    // Raising the look-at target pushes the scene down the screen. Below the
    // reference height the callouts need more headroom than shrinking alone
    // buys, since Solar anchors to the roof — the highest point in the scene.
    const shortfall = Math.max(0, REFERENCE_HEIGHT - height) / REFERENCE_HEIGHT;
    cam.lookAt(CAMERA_TARGET[0], CAMERA_TARGET[1] + shortfall * 1.6, CAMERA_TARGET[2]);
    cam.updateProjectionMatrix();
  }, [camera, height]);

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

  const solarControl = SOLAR_CONTROL;
  const gridControl = GRID_CONTROL;
  const batteryControl = BATTERY_CONTROL;
  const loadControl = LOAD_CONTROL;

  return (
    <div className={cn("relative w-full", className)}>
      {/* Fleet count as a low-profile corner overlay rather than a badge over
          the house. Inked against the studio background, not the app theme —
          `text-foreground` here rendered white-on-white in dark mode. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <div className="font-mono text-lg font-semibold tabular-nums" style={{ color: STUDIO_INK.strong }}>
          {summary.online_sites}
          <span style={{ color: STUDIO_INK.muted }}>/{summary.total_sites}</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide" style={{ color: STUDIO_INK.muted }}>
          sites online
        </div>
      </div>

      <Canvas
        shadows="soft"
        orthographic
        camera={{ position: CAMERA_POSITION, zoom: CAMERA_ZOOM, near: 0.1, far: 60 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true }}
      >
        <ResponsiveCamera />
        <color attach="background" args={[STUDIO.background]} />
        <GradientBackdrop />

        {/* Bright studio lighting. The key light is deliberately weaker than
            it was and its shadow much softer: the old rig threw long, hard,
            dark shadows (the carport cast a grey trapezoid over the whole
            lower-right quadrant) which is the opposite of how an
            architectural render grounds a building. Ambient and hemisphere
            carry more of the load now, and the tight ContactShadow blobs
            below do the grounding. */}
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

        {/* Faint cast shadow, plus a soft blob under each mass. */}
        <ShadowFloor opacity={0.12} />
        <ContactShadow position={[0, 0.004, 0.1]} width={4.4} depth={3.4} opacity={0.34} />
        <ContactShadow position={[BATTERY_POSITION[0], 0.003, BATTERY_POSITION[2]]} width={1.2} depth={1.0} opacity={0.22} />
        <ContactShadow position={[PYLON_POSITION[0], 0.003, PYLON_POSITION[2]]} width={1.6} depth={1.4} opacity={0.16} />

        {/* The living-room television is lit whenever the fleet draws load,
            using the same threshold as the Load flow edge so the screen and
            the animated conduit can never disagree. */}
        <House loadActive={loadW > POWER_FLOW_THRESHOLD_W} />
        <BatteryPack accentColor={ACCENTS.battery} soc={summary.avg_soc} />
        {/* Parked front-left and well clear of the battery cabinet — at
            X = -2.75 the two masses crowded each other and the car's nose
            overlapped the cabinet from this camera. On the right it would
            sit in front of the sectioned rooms and hide the thing the
            cutaway exists to show. To swap in a downloaded model instead,
            see public/models/README.md. */}
        <Car position={[-3.55, 0, 1.95]} rotation={Math.PI * 0.14} length={1.15} />
        <ContactShadow position={[-3.55, 0.003, 1.95]} width={1.8} depth={1.2} opacity={0.26} />
        <GridPylon />

        {/* Power-flow edges (subtle neon) */}
        <PowerFlowEdge3D
          from={SOLAR_PANEL_ANCHOR}
          to={HOUSE_HUB_ANCHOR}
          control={solarControl}
          active={solarW > POWER_FLOW_THRESHOLD_W}
          reverse={false}
          speed={scalePowerFlowSpeed(solarW, maxWatts)}
          particleCount={2}
          color={ACCENTS.solar}
        />
        <PowerFlowEdge3D
          from={PYLON_ANCHOR}
          to={HOUSE_HUB_ANCHOR}
          control={gridControl}
          active={Math.abs(gridW) > POWER_FLOW_THRESHOLD_W}
          reverse={gridW < 0}
          speed={scalePowerFlowSpeed(gridW, maxWatts)}
          particleCount={2}
          color={ACCENTS.grid}
        />
        <PowerFlowEdge3D
          from={BATTERY_ANCHOR}
          to={HOUSE_HUB_ANCHOR}
          control={batteryControl}
          active={Math.abs(batteryW) > POWER_FLOW_THRESHOLD_W}
          // Declared battery->hub, so non-reversed = discharge; charging
          // (batteryW >= 0) is the reversed (hub->battery) case.
          reverse={batteryW >= 0}
          speed={scalePowerFlowSpeed(batteryW, maxWatts)}
          particleCount={2}
          color={ACCENTS.battery}
        />
        <PowerFlowEdge3D
          from={HOUSE_HUB_ANCHOR}
          to={HOUSE_LOAD_ANCHOR}
          control={loadControl}
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
      </Canvas>
    </div>
  );
}
