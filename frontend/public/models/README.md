# 3D model drop-in

The power-flow scene (`src/components/dashboard/scene/`) is procedural: the
house, battery cabinet, lattice pylon and car are all built from three.js
primitives at runtime. Nothing here is required for the app to work, and the
directory ships empty.

## Why no .glb is bundled by default

> **Re-evaluate this.** The reasoning below was written when the panel was
> ~380 px tall and the scene was lit flat. Two things have changed:
>
> 1. **The panel is much bigger.** It is now 600 px on the dashboard and takes
>    71% of the wall display, and the camera scales the scene to fill it —
>    roughly 1.6x linear on a 1920 desktop and up to 2.7x on a 4K wall screen.
>    The car is no longer a 40 px smudge, so geometry detail now survives to
>    the screen in a way it did not.
> 2. **The scene is properly lit.** It now runs ambient occlusion, Neutral
>    tone mapping, real contact shadows and sheened materials. The warning
>    below that a photoscanned PBR asset "will look pasted in" was true of a
>    flat-lit scene; a well-lit one is far more forgiving, and the gap between
>    a primitive and a real model is correspondingly more visible.
>
> The download-size argument still stands on its own. The aesthetic argument
> largely does not.

The scene originally rendered into a ~380 px dashboard panel, where the car
was about 40 px tall on screen. Real candidates measured against that:

| Asset | Licence | Size | Notes |
|---|---|---|---|
| Khronos `CarConcept` (glTF-Binary) | CC BY 4.0 | 11.8 MB | needs attribution |
| Khronos `CarConcept` (Draco + KTX2) | CC BY 4.0 | 3.5 MB / 16 files | needs Draco + KTX2 WASM transcoders |
| Khronos `ToyCar` | CC0 1.0 | 5.4 MB | public domain, but toy proportions |

Shipping megabytes and a WASM transcoder chain so an operator can see a
slightly nicer car beside the number that tells them a site is down is a bad
trade, so the default build doesn't. The loader below exists so that
decision stays yours rather than being baked in.

### Decoders

**Draco is already self-hosted and wired up.** `GltfModel` passes
`/decoders/draco/` to `useGLTF`, served from `public/decoders/draco/` (copied
out of the `three` package at the version we build against). drei's default is
to fetch the decoder from `https://www.gstatic.com/draco/versioned/decoders/`,
which puts a third-party CDN on the critical path of rendering the dashboard —
it fails closed under a strict CSP and on a restricted-network deployment. The
files are only fetched when a Draco-compressed asset is actually loaded, so
they cost nothing today. Meshopt is enabled too; drei bundles that decoder, so
it adds no network dependency.

**KTX2/Basis is not set up.** The transcoder is another ~570 KB and is only
needed for KTX2-compressed *textures*, which the low-poly, lightly-textured
props recommended below do not use. If you bring in an asset that needs it,
copy `node_modules/three/examples/jsm/libs/basis/` to
`public/decoders/basis/` and attach a `KTX2Loader` via `useGLTF`'s
`extendLoader` argument — do not let it reach for a CDN.

When preloading, call `preloadModel()` from `gltf-model.tsx` rather than
`useGLTF.preload()` directly. drei keys its cache on the loader arguments, so
a bare preload is a different cache entry from the one `GltfModel` reads: the
fetch would be wasted and would hit the Draco CDN on the way.

## Dropping a model in

1. Put the file here, e.g. `frontend/public/models/car.glb`.
2. Render it with the `GltfModel` wrapper, passing the procedural component
   as the Suspense fallback so the scene never pops empty while it streams:

```tsx
import { GltfModel } from "@/components/dashboard/scene/gltf-model";
import { Car } from "@/components/dashboard/scene/car";

<GltfModel
  url="/models/car.glb"
  targetHeight={0.62}          // world units; the model is scaled to this
  position={[-2.35, 0, 1.15]}
  rotation={Math.PI * 0.12}
  fallback={<Car position={[-2.35, 0, 1.15]} />}
/>
```

`GltfModel` normalises whatever you give it: the model is scaled so its
bounding-box height matches `targetHeight`, centred horizontally, and seated
on Y = 0. Export scale and origin therefore don't matter, and swapping one
asset for another is a file change rather than a code change.

3. Optionally preload so it is fetched alongside the rest of the route.
   Use `preloadModel`, not `useGLTF.preload` — see Decoders below for why:

```tsx
import { preloadModel } from "@/components/dashboard/scene/gltf-model";

preloadModel("/models/car.glb");
```

## Sourcing

- **Poly Haven** — CC0, no attribution. Props and furniture; no vehicles.
- **Khronos glTF-Sample-Assets** — mixed CC0 / CC BY 4.0, per-model
  `LICENSE.md`. Good for testing the loader.
- **Quaternius**, **Kenney** — CC0 low-poly packs; stylistically closer to
  this scene than photoscanned PBR assets.
- **Sketchfab** — filter by licence; CC BY requires visible attribution.

Prefer low-poly, untextured or lightly-textured models. The scene is lit as
a bright studio render with flat matte materials, so a photoscanned car with
4K carbon-fibre maps will look pasted in as well as costing the download.
