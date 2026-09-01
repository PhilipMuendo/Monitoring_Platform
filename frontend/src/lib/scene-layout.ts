// Shared cross-file spatial constant for the 3D power-flow scene.
//
// The grid pylon stands far out to the left of the house (see
// scene/grid-pylon.tsx), which opened up a wide gap between it and the
// house that the composition wasn't using. This shifts the house — and
// everything that has to move WITH it to stay physically consistent (its
// paved apron/drive/path in scene/compound.tsx, and the battery + canopy
// standing on that apron in scene/battery-pack.tsx) — rightward to close
// that gap, while the pylon itself stays exactly where it stands, since
// it's meant to read as a distant service connection.
//
// A single shared constant rather than a magic number repeated in four
// files: house.tsx, compound.tsx and battery-pack.tsx each apply it
// directly to their own local geometry (so their own rendered meshes
// move), while fleet-3d-power-flow.tsx additionally adds it to the
// house-derived anchors it imports for routing and callouts — those
// anchors are LOCAL to the house's own coordinate space on purpose (see
// the long note on HOUSE_OFFSET_X in house.tsx for why), so anything that
// consumes them as true world-space points has to add this back in itself.
export const HOUSE_OFFSET_X = 1.5;
