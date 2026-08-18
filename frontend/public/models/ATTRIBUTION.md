# Third-party 3D model attribution

Every model bundled under `frontend/public/models/` is listed here with its
licence and required credit. **This file is a licence obligation, not
documentation** — CC BY requires attribution, so a model must not be added to
this directory without a corresponding entry, and an entry must not be removed
while the model ships.

The credits are also surfaced in the running app (see
`src/components/dashboard/scene/model-credits.ts`), because a notice buried in
a repository file is not "reasonable to the medium" for a licence that
requires attribution to the people who see the work.

---

## No models are currently bundled

The 3D power-flow scene is built entirely from procedural geometry. There is
nothing in this directory that requires attribution, and `MODEL_CREDITS` in
`model-credits.ts` is an empty array to match.

### What used to be here

`car.glb` — Khronos `CarConcept`, © 2024 Darmstadt Graphics Group GmbH, model
and textures by Eric Chadwick, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
from [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept).
Draco-compressed and re-seated at load time by `GltfModel`.

Removed because it cost 4 MB plus a ~750 KB Draco decoder — more than three
times the entire 3D scene chunk — for an object rendering about 40 px wide,
and because its saturated red paint was the loudest colour on the panel,
pulling the eye away from the four semantic flow colours it existed to
support. The undercroft still reads as a carport: `scene/compound.tsx` puts a
paved apron in front of it.

This paragraph is history, not a live obligation. The asset no longer ships.

---

## Adding a model

1. Prefer **CC0** — no attribution, no ongoing obligation.
2. If the only viable asset is **CC BY**, add a section above *and* an entry in
   `model-credits.ts`. The panel renders whatever is in that array, so the
   credit appears by itself.
3. Avoid recognisable production vehicles, brands and logos regardless of the
   3D licence. Body shapes and badges are separately trademarked and
   design-protected, and this is a commercial product delivered to a client.
