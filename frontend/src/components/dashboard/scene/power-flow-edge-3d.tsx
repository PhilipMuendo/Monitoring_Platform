"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type Waypoint = readonly [number, number, number];

interface PowerFlowEdge3DProps {
  /** Ordered waypoints, source -> destination, in world space. */
  points: readonly Waypoint[];
  active: boolean;
  /** true = chevrons visually travel from the last waypoint toward the first. */
  reverse: boolean;
  /** loops per second along the run; scales with the edge's power magnitude. */
  speed: number;
  particleCount: number;
  color: string;
  /**
   * The trunking's own colour, from SCENE_LIGHTING's `ink.conduit`.
   *
   * Phase-dependent rather than a constant: the daylight grey sits a few steps
   * from the night facade it is mounted on, and four invisible runs is the
   * whole diagram gone.
   */
  conduitColor: string;
}

// A conduit run with small chevron arrows travelling along it.
//
// Routed as an ORTHOGONAL POLYLINE with filleted corners, not as a single
// smooth curve through open space.
//
// The previous version was one quadratic Bezier per run, with a hand-tuned
// control point. That could never look right, and moving the control points
// around only relocated the problem:
//
//   * A Bezier bulges away from the surface it is supposed to follow, so the
//     runs floated in mid-air rather than reading as cable fixed to a wall.
//   * To keep the curves out of the building mass their controls had to be
//     thrown far forward of the facade — straight toward the camera, which
//     looks along +Z as much as +X. A tube seen end-on foreshortens into a
//     smear, which is exactly what the inverter-to-television run looked like.
//   * Real electrical services do not follow parabolas. They run flat against
//     surfaces, turn at right angles, and drop vertically into equipment.
//     Sosen's plant view draws them exactly that way, which is why theirs
//     read instantly as cabling and ours read as grey tubing.
//
// Corners are filleted rather than mitred because a genuinely sharp bend
// makes TubeGeometry's Frenet frames spin, and because real conduit has a
// bend radius anyway.
function roundedPolyline(points: readonly Waypoint[], radius: number): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const pts = points.map((p) => new THREE.Vector3(...p));
  if (pts.length < 2) return path;

  let cursor = pts[0].clone();

  for (let i = 1; i < pts.length - 1; i++) {
    const corner = pts[i];
    const incoming = new THREE.Vector3().subVectors(corner, cursor);
    const outgoing = new THREE.Vector3().subVectors(pts[i + 1], corner);
    const inLength = incoming.length();
    const outLength = outgoing.length();
    // Degenerate waypoint (repeated point) — nothing to round.
    if (inLength < 1e-6 || outLength < 1e-6) continue;

    incoming.normalize();
    outgoing.normalize();
    // Never eat more than half of either leg, or adjacent fillets overlap and
    // the run doubles back on itself.
    const r = Math.min(radius, inLength * 0.5, outLength * 0.5);

    const cornerStart = corner.clone().addScaledVector(incoming, -r);
    const cornerEnd = corner.clone().addScaledVector(outgoing, r);

    if (cursor.distanceTo(cornerStart) > 1e-6) {
      path.add(new THREE.LineCurve3(cursor, cornerStart));
    }
    path.add(new THREE.QuadraticBezierCurve3(cornerStart, corner.clone(), cornerEnd));
    cursor = cornerEnd;
  }

  const end = pts[pts.length - 1];
  if (cursor.distanceTo(end) > 1e-6) {
    path.add(new THREE.LineCurve3(cursor, end.clone()));
  }
  return path;
}

const CORNER_RADIUS = 0.07;

export function PowerFlowEdge3D({ points, active, reverse, speed, particleCount, color, conduitColor }: PowerFlowEdge3DProps) {
  // Chevrons follow the run in the direction power actually flows, so the
  // travel path is simply the route read backwards when reversed.
  const curve = useMemo(
    () => roundedPolyline(reverse ? [...points].reverse() : points, CORNER_RADIUS),
    [points, reverse],
  );

  // The conduit itself is a neutral grey run, not an accent-coloured line.
  // Only the moving arrows carry colour, which keeps four simultaneous flows
  // from turning the render into a tangle of coloured string.
  const tube = useMemo(() => {
    const path = roundedPolyline(points, CORNER_RADIUS);
    // Segment count scales with length so a long parapet run is not visibly
    // faceted while a short drop does not waste geometry.
    const segments = Math.max(24, Math.round(path.getLength() * 22));
    return new THREE.TubeGeometry(path, segments, 0.017, 8, false);
  }, [points]);

  // r3f only auto-disposes what it created itself. This geometry is built
  // here and handed over via the `geometry` prop, so it outlives the scene
  // unless we free it — and the whole Canvas unmounts every time someone
  // flips the 2D/3D toggle.
  useEffect(() => () => tube.dispose(), [tube]);

  return (
    <group>
      {/* Near-opaque. At 0.55 the wall behind showed through and every run
          turned into a grey haze rather than a line — worst where a run
          crossed glazing, itself semi-transparent, so two translucent
          surfaces stacked. Only the inactive state stays washed out, and
          that carries meaning: nothing is flowing on this leg. */}
      <mesh geometry={tube} castShadow>
        <meshStandardMaterial
          color={conduitColor}
          roughness={0.65}
          metalness={0.1}
          transparent
          opacity={active ? 0.95 : 0.4}
        />
      </mesh>
      {active &&
        Array.from({ length: particleCount }).map((_, i) => (
          <FlowChevron key={i} curve={curve} phase={i / particleCount} speed={speed} color={color} />
        ))}
    </group>
  );
}

// Chevron built once at module scope and shared by every arrow — a flat
// two-armed "V" lying in the XZ plane, pointing down +Z, which is the axis
// lookAt orients toward the direction of travel.
const CHEVRON_GEOMETRY = (() => {
  const shape = new THREE.Shape();
  // Sized against the 0.017-radius conduit it rides on. The previous
  // 0.14 x 0.19 arrow was roughly eight times the width of its own line and
  // read as a glyph floating nearby rather than as flow along the run.
  const halfSpan = 0.085;
  const depth = 0.12;
  const thickness = 0.04;
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(0, depth);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(halfSpan - thickness, 0);
  shape.lineTo(0, depth - thickness * 1.4);
  shape.lineTo(-halfSpan + thickness, 0);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  // ShapeGeometry builds in XY; rotate so the arrow lies flat facing +Z.
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  return geometry;
})();

function FlowChevron({
  curve,
  phase,
  speed,
  color,
}: {
  curve: THREE.CurvePath<THREE.Vector3>;
  phase: number;
  speed: number;
  color: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    elapsed.current += delta;
    const t = (phase + elapsed.current * speed) % 1;

    // getPointAt / getTangentAt, not getPoint / getTangent: on a CurvePath
    // built from segments of very different lengths, the unparameterised
    // versions crawl through short fillets and jump across long straights.
    // Arc-length parameterisation keeps the arrows moving at a constant
    // speed along the whole run.
    const point = curve.getPointAt(t);
    mesh.position.copy(point);

    const tangent = curve.getTangentAt(t);
    lookTarget.copy(point).add(tangent);
    mesh.lookAt(lookTarget);

    // Fade in and out at the ends so arrows don't pop into existence on top
    // of the node they're travelling toward.
    const fade = Math.min(1, Math.min(t, 1 - t) * 8);
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = fade;
  });

  return (
    <mesh ref={meshRef} geometry={CHEVRON_GEOMETRY}>
      <meshBasicMaterial color={color} transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
