# 3D model drop-in

The power-flow scene (`src/components/dashboard/scene/`) is **entirely
procedural**: the house, its interior, the battery cabinet, the lattice pylon
and the whole compound — lawn, paving and security lighting — are built
from three.js primitives at runtime. Nothing in this directory is required for
the app to work, and it ships with no models in it.

## Why no .glb is bundled

One was, and it was removed. `car.glb` (Khronos `CarConcept`, CC BY 4.0)
shipped 4 MB of Draco-compressed geometry plus a ~750 KB decoder — more than
three times the size of the entire 3D scene chunk — and was withdrawn for four
reasons that are worth keeping written down, because the first is the weakest
and the last is the one that actually settled it:

1. **Download size.** 4.75 MB on a panel that is opt-in to begin with.
2. **Decode cost.** ~162k vertices through a WASM Draco decoder on the main
   thread, including 24k-primitive windscreen wipers.
3. **Licence.** CC BY requires the credit to render *in the app*, so the panel
   permanently carried an attribution line for a prop.
4. **Composition.** Its saturated red was the loudest colour in the render —
   louder than any of the four semantic flow colours. On a panel whose entire
   job is to show colour-coded power flows, the eye went to a parked car.

The undercroft still reads as a carport: `scene/compound.tsx` puts a paved
apron and a drive in front of it.

Candidates that were measured, if a vehicle is ever wanted again:

| Asset | Licence | Size | Notes |
|---|---|---|---|
| Khronos `CarConcept` (glTF-Binary) | CC BY 4.0 | 11.8 MB | needs attribution |
| Khronos `CarConcept` (Draco + KTX2) | CC BY 4.0 | 3.5 MB / 16 files | needs Draco + KTX2 WASM transcoders |
| Khronos `ToyCar` | CC0 1.0 | 5.4 MB | public domain, but toy proportions |

Prefer CC0. Anything CC BY needs an entry in `scene/model-credits.ts` as well
as in `ATTRIBUTION.md` — the renderer maps over that array, so adding the
entry is all it takes for the credit to reappear on screen.

The loader below is kept wired up so that decision stays open rather than
being baked in. It costs nothing while unused: no module imports it, so it is
tree-shaken out of the scene chunk entirely.

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
