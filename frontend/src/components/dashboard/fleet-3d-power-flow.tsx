"use client";

import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { BatteryPack, BATTERY_ANCHOR } from "@/components/dashboard/scene/battery-pack";
import { Car } from "@/components/dashboard/scene/car";
import { ShadowFloor } from "@/components/dashboard/scene/ground";
import { GridPylon, PYLON_ANCHOR } from "@/components/dashboard/scene/grid-pylon";
import { House, HOUSE_HUB_ANCHOR, HOUSE_LOAD_ANCHOR, SOLAR_PANEL_ANCHOR } from "@/components/dashboard/scene/house";
import { PowerFlowCallout3D } from "@/components/dashboard/scene/power-flow-callout-3d";
import { PowerFlowEdge3D } from "@/components/dashboard/scene/power-flow-edge-3d";
import { formatPercent, formatPower } from "@/lib/format";
import { POWER_FLOW_COLORS, STUDIO } from "@/lib/power-flow-colors";
import { POWER_FLOW_THRESHOLD_W, scalePowerFlowSpeed } from "@/lib/power-flow-scale";
import type { FleetSummary } from "@/lib/types";

const CAMERA_POSITION: [number, number, number] = [7.6, 5.2, 8.2];
const CAMERA_TARGET: [number, number, number] = [0.2, 1.2, 0];
const CAMERA_ZOOM = 48;

// Always render in the bright studio palette — the reference is a clean,
// well-lit architectural render regardless of app theme, and the user
// wants it light. Only the semantic accent colors come from the tokens.
const ACCENTS = POWER_FLOW_COLORS.light;

const CARPORT_X = 2.15;

function midpoint(a: [number, number, number], b: [number, number, number], lift: number): [number, number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + lift, (a[2] + b[2]) / 2];
}

function FixedCamera() {
  const { camera } = useThree();
  useEffect(() => {
    camera.lookAt(...CAMERA_TARGET);
    camera.updateProjectionMatrix();
  }, [camera]);
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

function Carport() {
  return (
    <group position={[CARPORT_X, 0, 0.1]}>
      <RoundedBox args={[1.55, 0.09, 1.95]} radius={0.03} smoothness={3} position={[0, 1.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={STUDIO.roof} roughness={0.75} metalness={0.02} />
      </RoundedBox>
      {[
        [0.68, -0.88],
        [0.68, 0.88],
        [-0.55, -0.88],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.7, z]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 1.4, 12]} />
          <meshStandardMaterial color={STUDIO.metalDark} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export function Fleet3DPowerFlow({ summary }: { summary: FleetSummary }) {
  const solarW = summary.total_power_w;
  const loadW = summary.total_load_w;
  const gridW = summary.total_grid_w;
  const batteryW = summary.total_battery_w;
  const maxWatts = Math.max(solarW, loadW, Math.abs(gridW), Math.abs(batteryW), 1000);

  const solarControl = midpoint(SOLAR_PANEL_ANCHOR, HOUSE_HUB_ANCHOR, 0.5);
  const gridControl = midpoint(PYLON_ANCHOR, HOUSE_HUB_ANCHOR, 0.4);
  const batteryControl = midpoint(BATTERY_ANCHOR, HOUSE_HUB_ANCHOR, 0.35);
  const loadControl = midpoint(HOUSE_HUB_ANCHOR, HOUSE_LOAD_ANCHOR, 0.25);

  return (
    <div className="relative h-[320px] w-full sm:h-[380px]">
      {/* Fleet count as a low-profile corner overlay rather than a badge over the house */}
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
          {summary.online_sites}
          <span className="text-muted-foreground">/{summary.total_sites}</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">sites online</div>
      </div>

      <Canvas
        shadows="soft"
        orthographic
        camera={{ position: CAMERA_POSITION, zoom: CAMERA_ZOOM, near: 0.1, far: 60 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true }}
      >
        <FixedCamera />
        <color attach="background" args={[STUDIO.background]} />

        {/* Bright studio lighting. Key light from the upper-left so the soft
            shadow falls down and to the right, anchoring the structure. */}
        <ambientLight intensity={0.5} />
        <hemisphereLight color="#ffffff" groundColor="#d7dce4" intensity={0.5} />
        <directionalLight
          position={[-5.5, 9, 5]}
          intensity={1.7}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-radius={5}
          shadow-bias={-0.0002}
        >
          <orthographicCamera attach="shadow-camera" args={[-9, 9, 9, -9, 0.1, 30]} />
        </directionalLight>

        <StudioEnvironment />

        {/* Shadow-only receiver: catches the directional light's soft cast
            (down and to the right) to anchor the structure. */}
        <ShadowFloor opacity={0.3} />

        <House />
        <Carport />
        <Car position={[CARPORT_X - 0.05, 0, 0.1]} />
        <BatteryPack accentColor={ACCENTS.battery} soc={summary.avg_soc} />
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

        {/* Minimalist dashed-line callouts — placed with generous leader
            lengths so labels sit clear of the geometry. */}
        <PowerFlowCallout3D
          anchor={SOLAR_PANEL_ANCHOR}
          label="Solar"
          value={formatPower(solarW)}
          colorClass="text-solar"
          placement="top"
          lineLength={58}
        />
        <PowerFlowCallout3D
          anchor={PYLON_ANCHOR}
          label="Grid"
          value={formatPower(Math.abs(gridW))}
          sublabel={gridW >= 0 ? "importing" : "exporting"}
          colorClass="text-grid"
          placement="top"
          lineLength={44}
        />
        <PowerFlowCallout3D
          anchor={[HOUSE_LOAD_ANCHOR[0], HOUSE_LOAD_ANCHOR[1] + 0.2, HOUSE_LOAD_ANCHOR[2]]}
          label="Load"
          value={formatPower(loadW)}
          colorClass="text-load"
          placement="top"
          lineLength={84}
        />
        {/* Battery callout sits ABOVE the battery (well to the left of the
            house) so it never overlaps the building windows. */}
        <PowerFlowCallout3D
          anchor={BATTERY_ANCHOR}
          label="Battery"
          value={formatPercent(summary.avg_soc)}
          sublabel={`${batteryW >= 0 ? "charging" : "discharging"} ${formatPower(Math.abs(batteryW))}`}
          colorClass="text-battery"
          placement="top"
          lineLength={40}
        />
      </Canvas>
    </div>
  );
}
