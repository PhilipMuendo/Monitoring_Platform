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

## car.glb — concept car in the undercroft

| | |
|---|---|
| **Title** | CarConcept |
| **Author** | Eric Chadwick (model and textures) |
| **Copyright** | © 2024, Darmstadt Graphics Group GmbH |
| **Licence** | [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/) |
| **Source** | [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) |
| **Changes** | Draco geometry compression, textures resized to 512 px and re-encoded to WebP, via `@gltf-transform/cli optimize`. Scaled and re-seated at load time by `GltfModel`. |

CC BY requires that changes be indicated; the "Changes" row above does that.

Chosen over a more photoreal alternative deliberately: it is a **concept car
with no brand identity**. Car body shapes and badges are trademarked and
design-protected, and this is a commercial product delivered to a client, so a
recognisable production vehicle in the dashboard is an avoidable legal edge —
whatever the vendor references happen to do.

### Required credit string

> "CarConcept" by Eric Chadwick / Darmstadt Graphics Group GmbH, licensed under CC BY 4.0
