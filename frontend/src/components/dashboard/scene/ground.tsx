"use client";

// An invisible floor that only shows the soft shadow the scene casts onto
// it (THREE.ShadowMaterial). This grounds the house into the bright studio
// background seamlessly — no visible slab — matching the reference look.
export function ShadowFloor({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <shadowMaterial transparent opacity={opacity} />
    </mesh>
  );
}
