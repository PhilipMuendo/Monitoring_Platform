# 3D model drop-in

The power-flow scene (`src/components/dashboard/scene/`) is procedural: the
house, battery cabinet, lattice pylon and car are all built from three.js
primitives at runtime. Nothing here is required for the app to work, and the
directory ships empty.

## Why no .glb is bundled by default

The scene renders into a ~380 px dashboard panel. The car is about 40 px
tall on screen. Real candidates measured against that:

| Asset | Licence | Size | Notes |
|---|---|---|---|
| Khronos `CarConcept` (glTF-Binary) | CC BY 4.0 | 11.8 MB | needs attribution |
| Khronos `CarConcept` (Draco + KTX2) | CC BY 4.0 | 3.5 MB / 16 files | needs Draco + KTX2 WASM transcoders |
| Khronos `ToyCar` | CC0 1.0 | 5.4 MB | public domain, but toy proportions |

Shipping megabytes and a WASM transcoder chain so an operator can see a
slightly nicer car beside the number that tells them a site is down is a bad
trade, so the default build doesn't. The loader below exists so that
decision stays yours rather than being baked in.

The KTX2 route additionally needs care: drei's `useGLTF` fetches the Basis
transcoder from a CDN unless you point `KTX2Loader` at a self-hosted copy,
which will not survive a strict CSP.

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

3. Optionally preload so it is fetched alongside the rest of the route:

```tsx
useGLTF.preload("/models/car.glb");
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
