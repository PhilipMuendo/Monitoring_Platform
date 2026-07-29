"use client";

import { useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

/**
 * Loads a .glb from /public/models and drops it into the scene, normalised
 * so the author's export scale and origin don't matter.
 *
 * The scene is otherwise entirely procedural. This exists so a purchased or
 * CC0 asset can be swapped in for any prop without reworking the scene —
 * see public/models/README.md for the drop-in procedure and for why the
 * default build ships no .glb files at all.
 *
 * The model is normalised to `targetHeight` world units and re-seated so
 * its base sits on Y=0, because sample assets vary wildly (Khronos' own
 * CarConcept exports ~4.4 units long, Sketchfab models are often in
 * centimetres) and hardcoding a scale per asset would make swapping one out
 * a code change rather than a file change.
 */
function NormalisedModel({
  url,
  targetHeight,
  position,
  rotation,
  castShadow,
}: {
  url: string;
  targetHeight: number;
  position: [number, number, number];
  rotation: number;
  castShadow: boolean;
}) {
  const { scene } = useGLTF(url);

  const prepared = useMemo(() => {
    // Clone so two instances of the same URL can't fight over one transform.
    const root = scene.clone(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    root.scale.setScalar(scale);

    // Re-measure after scaling, then sit the model on the ground plane and
    // centre it horizontally on its own bounding box.
    const scaled = new THREE.Box3().setFromObject(root);
    const centre = new THREE.Vector3();
    scaled.getCenter(centre);
    root.position.set(-centre.x, -scaled.min.y, -centre.z);

    if (castShadow) {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }

    return root;
  }, [scene, targetHeight, castShadow]);

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <primitive object={prepared} />
    </group>
  );
}

export function GltfModel({
  url,
  targetHeight,
  position,
  rotation = 0,
  castShadow = true,
  fallback = null,
}: {
  url: string;
  targetHeight: number;
  position: [number, number, number];
  rotation?: number;
  castShadow?: boolean;
  /** Rendered while the asset streams in — pass the procedural stand-in. */
  fallback?: React.ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <NormalisedModel
        url={url}
        targetHeight={targetHeight}
        position={position}
        rotation={rotation}
        castShadow={castShadow}
      />
    </Suspense>
  );
}

export { useGLTF };
