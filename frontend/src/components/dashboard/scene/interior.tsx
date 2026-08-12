"use client";

import { RoundedBox } from "@react-three/drei";

import { STUDIO } from "@/lib/power-flow-colors";

// Furniture for the cutaway wing of the house.
//
// Everything here is a rounded primitive, deliberately. At the size this
// scene renders (a ~380px dashboard panel, the house maybe 300px tall) a
// sofa is roughly 30px across — modelled upholstery seams would be
// invisible while costing draw calls and load time. What actually reads at
// this scale is silhouette plus warm colour against the white shell, which
// is exactly what the reference render relies on too.
//
// Rooms are authored in local space with the origin at the room's
// floor centre, so House can place them without knowing their contents.

function Sofa({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* seat base */}
      <RoundedBox args={[0.62, 0.11, 0.27]} radius={0.04} smoothness={3} position={[0, 0.13, 0]} castShadow>
        <meshStandardMaterial color={STUDIO.sofa} roughness={0.9} />
      </RoundedBox>
      {/* backrest */}
      <RoundedBox args={[0.62, 0.2, 0.09]} radius={0.04} smoothness={3} position={[0, 0.24, -0.11]} castShadow>
        <meshStandardMaterial color={STUDIO.sofa} roughness={0.9} />
      </RoundedBox>
      {/* arms */}
      {[-0.29, 0.29].map((x) => (
        <RoundedBox key={x} args={[0.07, 0.15, 0.27]} radius={0.03} smoothness={3} position={[x, 0.19, 0]} castShadow>
          <meshStandardMaterial color={STUDIO.sofa} roughness={0.9} />
        </RoundedBox>
      ))}
      {/* one accent cushion — the only saturated thing in the room, and the
          reason the interior reads as furnished rather than beige-on-beige */}
      <RoundedBox args={[0.13, 0.12, 0.05]} radius={0.03} smoothness={3} position={[-0.15, 0.24, -0.03]} rotation={[0.2, 0, 0]}>
        <meshStandardMaterial color={STUDIO.sofaAccent} roughness={0.95} />
      </RoundedBox>
      {/* legs */}
      {[
        [-0.26, 0.1],
        [0.26, 0.1],
        [-0.26, -0.1],
        [0.26, -0.1],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.04, z]}>
          <cylinderGeometry args={[0.014, 0.014, 0.08, 8]} />
          <meshStandardMaterial color={STUDIO.wood} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.34, 0.035, 0.2]} radius={0.015} smoothness={3} position={[0, 0.17, 0]} castShadow>
        <meshStandardMaterial color={STUDIO.woodLight} roughness={0.55} />
      </RoundedBox>
      {[
        [-0.14, 0.07],
        [0.14, 0.07],
        [-0.14, -0.07],
        [0.14, -0.07],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.08, z]}>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
          <meshStandardMaterial color={STUDIO.wood} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function FloorLamp({ position, on = true }: { position: [number, number, number]; on?: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.02, 12]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.5, 8]} />
        <meshStandardMaterial color={STUDIO.metalDark} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Shade emits a little light of its own. Nothing in the studio rig
          reaches inside a sectioned room, so without this the back of the
          living room falls into flat shadow. Goes dark with the rest of the
          house when the fleet is drawing no load. */}
      <mesh position={[0, 0.56, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.13, 14, 1, true]} />
        <meshStandardMaterial
          color={STUDIO.lampShade}
          roughness={0.85}
          emissive={STUDIO.lampShade}
          emissiveIntensity={on ? 0.45 : 0}
          side={2}
        />
      </mesh>
      {on && <pointLight position={[0, 0.52, 0]} intensity={0.35} distance={1.4} decay={2} color="#ffeeda" />}
    </group>
  );
}

function PottedPlant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.04, 0.12, 12]} />
        <meshStandardMaterial color={STUDIO.linen} roughness={0.8} />
      </mesh>
      {[
        [0, 0.22, 0, 0],
        [0.04, 0.19, 0.02, 0.5],
        [-0.04, 0.2, -0.02, -0.45],
      ].map(([x, y, z, tilt], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, 0, tilt]} castShadow>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color={STUDIO.foliage} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Rug({ position, width, depth }: { position: [number, number, number]; width: number; depth: number }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color={STUDIO.rug} roughness={1} />
    </mesh>
  );
}

/**
 * Wall-mounted television whose screen is lit whenever the fleet is drawing
 * load, and dark when it isn't.
 *
 * This is the Load indicator. A bed or a picture frame is inert — it looks
 * identical at 0 W and 56 kW — whereas a screen that goes dark is something
 * anyone reads instantly without consulting the callout. It's mounted on the
 * partition wall, whose +X face is square-on to the camera and therefore the
 * most visible surface in the sectioned room.
 */
function Television({ position, on }: { position: [number, number, number]; on: boolean }) {
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      {/* bezel */}
      <RoundedBox args={[0.44, 0.26, 0.018]} radius={0.008} smoothness={3} castShadow>
        <meshStandardMaterial color="#2c313a" roughness={0.5} metalness={0.25} />
      </RoundedBox>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[0.41, 0.23]} />
        <meshStandardMaterial
          color={on ? "#cfe3ff" : "#171b22"}
          emissive={on ? "#7fbaff" : "#000000"}
          emissiveIntensity={on ? 1.15 : 0}
          roughness={0.32}
          toneMapped={false}
        />
      </mesh>
      {/* Screen spill onto the room. Cheap stand-in for emissive bounce,
          which needs global illumination we don't have here. */}
      {on && <pointLight position={[0, 0, 0.4]} intensity={0.55} distance={1.7} decay={2} color="#9ecbff" />}
      {/* low media unit beneath */}
      <mesh position={[0, -0.28, 0.03]} castShadow>
        <boxGeometry args={[0.5, 0.09, 0.13]} />
        <meshStandardMaterial color={STUDIO.woodLight} roughness={0.6} />
      </mesh>
    </group>
  );
}

function Bed({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* mattress */}
      <RoundedBox args={[0.56, 0.13, 0.72]} radius={0.03} smoothness={3} position={[0, 0.15, 0]} castShadow>
        <meshStandardMaterial color={STUDIO.linen} roughness={0.95} />
      </RoundedBox>
      {/* base */}
      <RoundedBox args={[0.58, 0.08, 0.74]} radius={0.02} smoothness={3} position={[0, 0.06, 0]} castShadow>
        <meshStandardMaterial color={STUDIO.wood} roughness={0.6} />
      </RoundedBox>
      {/* headboard against the back wall */}
      <RoundedBox args={[0.58, 0.3, 0.05]} radius={0.02} smoothness={3} position={[0, 0.24, -0.37]} castShadow>
        <meshStandardMaterial color={STUDIO.woodLight} roughness={0.65} />
      </RoundedBox>
      {/* pillows */}
      {[-0.13, 0.13].map((x) => (
        <RoundedBox key={x} args={[0.22, 0.06, 0.13]} radius={0.03} smoothness={3} position={[x, 0.24, -0.26]}>
          <meshStandardMaterial color="#ffffff" roughness={0.95} />
        </RoundedBox>
      ))}
      {/* folded throw at the foot */}
      <RoundedBox args={[0.57, 0.03, 0.2]} radius={0.015} smoothness={3} position={[0, 0.22, 0.2]}>
        <meshStandardMaterial color={STUDIO.sofaAccent} roughness={0.95} />
      </RoundedBox>
    </group>
  );
}

function Nightstand({ position, on = true }: { position: [number, number, number]; on?: boolean }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.16, 0.2, 0.16]} radius={0.02} smoothness={3} position={[0, 0.1, 0]} castShadow>
        <meshStandardMaterial color={STUDIO.woodLight} roughness={0.6} />
      </RoundedBox>
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.09, 12]} />
        <meshStandardMaterial
          color={STUDIO.lampShade}
          roughness={0.85}
          emissive={STUDIO.lampShade}
          emissiveIntensity={on ? 0.5 : 0}
        />
      </mesh>
    </group>
  );
}

/**
 * Ground-floor living room, origin at the room's floor centre.
 *
 * `loadActive` drives every light in the room — the television, the floor
 * lamp, and (in the bedroom) the bedside lamp. Below the load threshold the
 * house goes dark, which states "nothing is drawing power" faster than the
 * Load callout does. The studio fill lights in CutawayShell deliberately stay
 * on regardless: they stand in for the ambient the key light cannot reach
 * into a sectioned room, and killing them would turn the cutaway into a black
 * hole rather than a dark room.
 */
export function LivingRoom({ loadActive = false }: { loadActive?: boolean }) {
  return (
    <group>
      {/* Seating group pulled forward to z ~ 0.28, from z ~ 0.
          The room is only open on two faces — +X (no end wall) and +Z (the
          section cut) — and the camera looks in obliquely across both. Sitting
          at the middle of the room, the television ended up at the deepest,
          most foreshortened point from that viewpoint, half hidden behind the
          partition return. Everything the viewer is meant to read now sits in
          the forward third, near the open corner, with only the lamp and the
          plant left to occupy the back. */}
      <Rug position={[0, 0.006, 0.28]} width={0.9} depth={0.58} />
      {/* -PI/2, not +PI/2. The sofa is authored facing +Z (backrest at -Z),
          and rotating +90 deg about Y swings that to +X — which pointed it
          out through the open cutaway face, away from the room. The
          television is at x = -0.46, so the seat has to face -X to look at
          it across the coffee table. */}
      <Sofa position={[0.18, 0, 0.28]} rotation={-Math.PI / 2} />
      <CoffeeTable position={[-0.14, 0, 0.28]} />
      <FloorLamp position={[0.36, 0, -0.45]} on={loadActive} />
      <PottedPlant position={[-0.4, 0, -0.5]} />
      {/* Kept on the partition facing +X rather than moved to the back wall:
          the back wall faces the section cut, so a screen there would be seen
          nearly edge-on and the Load conduit would have to travel the whole
          depth of the building to reach it. TV_LOCAL in house.tsx mirrors this
          position — the Load callout anchors on it. */}
      <Television position={[-0.46, 0.62, 0.28]} on={loadActive} />
    </group>
  );
}

/** Upper-floor bedroom, origin at the room's floor centre. */
export function Bedroom({ loadActive = false }: { loadActive?: boolean }) {
  return (
    <group>
      <Rug position={[0.06, 0.006, 0.24]} width={0.6} depth={0.4} />
      <Bed position={[-0.06, 0, 0.02]} />
      <Nightstand position={[0.32, 0, -0.28]} on={loadActive} />
      <PottedPlant position={[0.36, 0, 0.34]} />
    </group>
  );
}
