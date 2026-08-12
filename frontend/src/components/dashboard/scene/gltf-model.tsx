"use client";

import { useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

/**
 * Where the Draco geometry decoder is served from.
 *
 * drei's useGLTF otherwise defaults to fetching it from
 * https://www.gstatic.com/draco/versioned/decoders/1.5.5/ — a third-party
 * runtime dependency on the critical path of rendering the dashboard. That
 * fails closed under any Content-Security-Policy worth having, fails outright
 * on an air-gapped or restricted-network deployment, and makes an operator's
 * dashboard depend on Google's CDN being reachable. The decoder is copied out
 * of the three package at the version we build against (see
 * public/decoders/draco/) so it is served from our own origin.
 *
 * Only fetched when a Draco-compressed asset is actually loaded, so it costs
 * nothing on a build that ships no models.
 */
const DRACO_DECODER_PATH = "/decoders/draco/";

/**
 * Loads a .glb from /public/models and drops it into the scene, normalised
 * so the author's export scale and origin don't matter.
 *
 * The scene is otherwise entirely procedural. This exists so a purchased or
 * CC0 asset can be swapped in for any prop without reworking the scene —
 * see public/models/README.md for the drop-in procedure.
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
  // Draco from our own origin (see DRACO_DECODER_PATH); Meshopt enabled, which
  // drei bundles rather than fetching, so it adds no network dependency.
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true);

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

/**
 * Preloads a model so it is fetched alongside the rest of the route instead
 * of when the component first renders.
 *
 * Use this rather than calling useGLTF.preload directly. drei keys its cache
 * on (path, useDraco, useMeshopt, extendLoader), so a bare
 * `useGLTF.preload("/models/car.glb")` is a *different* cache entry from the
 * one GltfModel reads — the preloaded copy would never be used, and it would
 * reach for the gstatic Draco CDN on the way. Going through here keeps the
 * arguments identical on both sides.
 */
export function preloadModel(url: string) {
  useGLTF.preload(url, DRACO_DECODER_PATH, true);
}

export { useGLTF };
