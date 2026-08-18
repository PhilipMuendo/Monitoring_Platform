import * as THREE from "three";

/**
 * The 3D power-flow scene's camera, in one place.
 *
 * These used to live inside fleet-3d-power-flow.tsx, which was fine while it
 * was the only thing that needed them. The backdrop now has to size itself to
 * exactly the frame the camera produces, and it cannot import from that module
 * without a cycle — fleet-3d-power-flow already imports the backdrop.
 */
export const CAMERA_POSITION: [number, number, number] = [7.6, 5.2, 8.2];
export const CAMERA_TARGET: [number, number, number] = [0.35, 1.25, 0];

/** Starting zoom only — the scene refits from the canvas on mount and resize. */
export const CAMERA_ZOOM = 62;
/** Canvas height the fixed camera framing was tuned against (the dashboard panel). */
export const REFERENCE_HEIGHT = 380;

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
// through this exact camera gives an on-screen extent of 8.50 world units, so
// 1 / (8.50 x 1.04 margin) is the zoom at which the scene exactly spans the
// panel width. An earlier guess of 0.105 left the view width-bound at every
// realistic size, which threw the taller panel away entirely — the scene came
// out *smaller* than before despite the card growing.
//
// Re-derived after the car moved into the undercroft. That single change
// collapsed the projected scene from 8.22 x 5.67 world units to 6.79 x 5.16 —
// the car had been sitting forward AND to the left of everything else, so it
// was setting both the width and the depth the camera had to cover. Fitting a
// smaller box means a larger zoom, which is why the building ends up roughly
// 2.4x its original on-screen size for no change in panel size at all.
const ZOOM_PER_PX_WIDTH = 0.1417;
const ZOOM_MIN = 30;
const ZOOM_MAX = 170;

/**
 * Pixels per world unit for a canvas of this size.
 *
 * The single definition of the framing law. The backdrop needs the same answer
 * the camera gets, and two copies of this drifting apart would show up as a
 * sky that no longer lines up with the frame.
 */
export function fitZoom(width: number, height: number): number {
  const fitted = Math.min(height * ZOOM_PER_PX_HEIGHT, width * ZOOM_PER_PX_WIDTH);
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitted));
}

/**
 * Orientation that makes a plane face the camera, and the direction "away from
 * the camera" for pushing it behind the scene.
 *
 * Built with Matrix4.lookAt, whose result is a rotation whose local +Z points
 * from the target back toward the camera — which is exactly a billboard, and
 * exactly the plane normal a backdrop wants.
 */
function cameraFacing() {
  const eye = new THREE.Vector3(...CAMERA_POSITION);
  const target = new THREE.Vector3(...CAMERA_TARGET);
  const matrix = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const towardCamera = eye.clone().sub(target).normalize();
  return { quaternion, towardCamera };
}

export const CAMERA_FACING = cameraFacing();
