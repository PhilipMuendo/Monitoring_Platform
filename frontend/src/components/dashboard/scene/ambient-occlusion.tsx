"use client";

import { EffectComposer, N8AO } from "@react-three/postprocessing";

/**
 * The scene's ambient-occlusion pass, isolated in its own module so it lands
 * in its own chunk.
 *
 * WHY THIS IS A SEPARATE FILE. This used to be imported statically by
 * fleet-3d-power-flow.tsx and merely *rendered* conditionally, which meant
 * `postprocessing` shipped inside the 1.2 MB scene chunk to every visitor —
 * including the WebGL1 devices that can never run it. The device most likely
 * to be on that path is the wall display's Smart TV, i.e. exactly the client
 * with the least bandwidth to spare, downloading a library it will not
 * execute. Splitting it means the building appears as soon as the scene chunk
 * lands and the shading arrives a moment later, rather than everyone waiting
 * on both.
 *
 * It is loaded through React.lazy rather than next/dynamic: this module is
 * already inside an ssr:false boundary, so there is nothing left for
 * next/dynamic to do, and plain lazy + Suspense is what the r3f reconciler
 * handles natively inside a <Canvas>.
 *
 * Ambient occlusion is the contact darkening in corners, under the roof
 * overhang and beneath the furniture — the single largest remaining
 * difference between a lit render and something that reads as a flat drawing.
 * Plain white surfaces only look solid once their creases are shaded.
 */
export function AmbientOcclusion({ intensity }: { intensity: number }) {
  return (
    // halfRes + depthAwareUpsampling computes AO at quarter the pixel count
    // and upsamples along depth edges; at the size this panel renders that is
    // visually indistinguishable and roughly a third of the cost.
    // multisampling is left on the composer rather than adding a separate
    // SMAA pass — WebGL2 gives MSAA on the render target for free, and that
    // is one fewer full-screen pass.
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO
        aoRadius={0.28}
        distanceFalloff={0.8}
        intensity={intensity}
        quality="medium"
        halfRes
        depthAwareUpsampling
        color="#2a3242"
      />
    </EffectComposer>
  );
}
