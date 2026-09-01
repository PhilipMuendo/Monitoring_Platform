"use client";

import { Html } from "@react-three/drei";

import type { StudioInk } from "@/lib/power-flow-colors";

type Placement = "top" | "bottom" | "left" | "right";

interface PowerFlowCallout3DProps {
  anchor: [number, number, number];
  label: string;
  value: string;
  sublabel?: string;
  /**
   * Text and leader colours for the phase the scene is currently in, from
   * SCENE_LIGHTING. Passed rather than imported because the canvas background
   * follows the clock in Kenya: near-black labels are correct at midday and
   * illegible over the night sky.
   */
  ink: StudioInk;
  /**
   * Accent for this quantity, from SCENE_LIGHTING's `accents` — not a theme
   * class. These labels sit on the canvas, whose background follows the clock
   * in Kenya rather than the app theme, so a `text-solar` class would pick
   * whichever variant the *page* is in and be wrong roughly half the time.
   *
   * Used only for the small marker dot. See the note on the value colour.
   */
  color: string;
  /**
   * Which side of the anchor the label sits on. Pick whichever side the
   * object actually has clear space on — there's no single right answer
   * across all four, which is exactly why this replaced the previous
   * "pin everything to one shared top row" design (see the note below).
   */
  placement?: Placement;
  /** Leader length in px, fixed rather than computed — see the note below. */
  leaderLength?: number;
}

// Minimalist data callout: a thin dashed leader connecting a text block to
// a component in the scene, on whichever side of it actually has room.
//
// This used to pin every callout's text block to one shared horizontal
// band near the top of the canvas, with a vertical leader dropping down to
// each anchor's real position and a per-callout screen-px nudge to keep
// the four text blocks from overlapping. That worked for the specific
// camera framing and anchor spread it was tuned against, but it doesn't
// generalise: it fights the layout instead of using it, and when two
// anchors happen to project close together in screen space (as Battery
// and Grid did once the battery moved out to its own canopy), no amount
// of nudging keeps two independent, variable-width text blocks from
// running into each other on the same line — the failure mode is baked
// into forcing unrelated things onto one shared row at all.
//
// Placing each label directly beside the thing it describes doesn't have
// that failure mode: two labels only collide if the two OBJECTS are close
// together on screen, which is a real layout problem worth fixing at the
// object's position rather than something a label nudge can paper over.
export function PowerFlowCallout3D({
  anchor,
  label,
  value,
  sublabel,
  color,
  ink,
  placement = "top",
  leaderLength = 40,
}: PowerFlowCallout3DProps) {
  const textBlock = (
    <div className="flex flex-col items-center leading-tight">
      {/* All three lines use ink.strong now, not just the value — these sit
          on open ground against paving/lawn rather than against the sky,
          and the ground plate's whole point is to read clearly at a
          glance, not to visually recede the way a caption on the roofline
          was allowed to. See the darkened, enlarged sizes below too. */}
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: ink.strong }}>
        {/* The accent survives as a 5px dot rather than tinting the whole
            readout. Four saturated values at once made the overlay look
            like a chart legend; the reference spends its colour budget on
            a single glyph and renders every number in near-black. */}
        <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-mono text-[18px] font-bold tabular-nums" style={{ color: ink.strong }}>
        {value}
      </span>
      {sublabel && (
        <span className="text-[11px] font-medium" style={{ color: ink.strong }}>
          {sublabel}
        </span>
      )}
    </div>
  );

  const vertical = placement === "top" || placement === "bottom";
  const leader = (
    <div
      className={vertical ? "flex flex-col items-center" : "flex flex-row items-center"}
      style={{ padding: vertical ? "6px 0" : "0 6px" }}
    >
      <div
        className={vertical ? "w-0 border-l border-dashed" : "h-0 border-t border-dashed"}
        style={vertical ? { height: leaderLength, borderColor: ink.line } : { width: leaderLength, borderColor: ink.line }}
      />
    </div>
  );

  // Stack order and the container's own anchor point both flip with
  // placement, so the LEADER always ends exactly at the anchor regardless
  // of which side the text sits on.
  const content =
    placement === "top" ? (
      <>
        {textBlock}
        {leader}
      </>
    ) : placement === "bottom" ? (
      <>
        {leader}
        {textBlock}
      </>
    ) : placement === "left" ? (
      <>
        {textBlock}
        {leader}
      </>
    ) : (
      <>
        {leader}
        {textBlock}
      </>
    );

  const containerTransform =
    placement === "top"
      ? "translate(-50%, -100%)"
      : placement === "bottom"
        ? "translate(-50%, 0%)"
        : placement === "left"
          ? "translate(-100%, -50%)"
          : "translate(0%, -50%)";

  return (
    <Html position={anchor} transform={false} pointerEvents="none">
      <div
        className={vertical ? "flex flex-col items-center" : "flex flex-row items-center"}
        style={{
          transform: containerTransform,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {content}
      </div>
    </Html>
  );
}
