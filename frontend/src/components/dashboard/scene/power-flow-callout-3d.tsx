"use client";

import { Html } from "@react-three/drei";

import { cn } from "@/lib/utils";

interface PowerFlowCallout3DProps {
  anchor: [number, number, number];
  label: string;
  value: string;
  sublabel?: string;
  /** Tailwind text-color class for the value, e.g. "text-solar". */
  colorClass: string;
  /** "top": text above, dashed line drops down to the component.
   *  "bottom": dashed line rises to the component, text below. */
  placement?: "top" | "bottom";
  /** length of the dashed connector in px. */
  lineLength?: number;
}

// Minimalist data callout: a thin dashed vertical line connecting a small
// text block (label + value) directly to a component in the scene —
// replacing the bulky floating icon badges. Rendered as screen-space HTML
// via drei's <Html> so text stays crisp and always readable.
export function PowerFlowCallout3D({
  anchor,
  label,
  value,
  sublabel,
  colorClass,
  placement = "top",
  lineLength = 42,
}: PowerFlowCallout3DProps) {
  const isTop = placement === "top";

  const textBlock = (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-[13px] font-semibold tabular-nums", colorClass)}>{value}</span>
      {sublabel && <span className="text-[9px] text-muted-foreground">{sublabel}</span>}
    </div>
  );

  // A small gap separates the text from the leader line so labels never
  // sit right on top of their endpoint.
  const line = (
    <div className={cn("flex flex-col items-center", isTop ? "pt-1.5" : "pb-1.5")}>
      <div className="w-0 border-l border-dashed border-muted-foreground/45" style={{ height: lineLength }} />
    </div>
  );

  return (
    <Html position={anchor} transform={false} pointerEvents="none">
      <div
        className="flex flex-col items-center"
        style={{
          transform: isTop ? "translate(-50%, -100%)" : "translate(-50%, 0)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {isTop ? (
          <>
            {textBlock}
            {line}
          </>
        ) : (
          <>
            {line}
            {textBlock}
          </>
        )}
      </div>
    </Html>
  );
}
