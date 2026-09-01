"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { memo } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { PowerFlowSkeleton } from "@/components/dashboard/power-flow-skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { useScene3D } from "@/hooks/use-scene-3d";
import { useWebGLTier } from "@/hooks/use-webgl-support";
import type { PowerFlowScene } from "@/lib/power-flow-model";
import { SCENE_PREFETCH_MIN_WIDTH } from "@/lib/scene-load-policy";
import { cn } from "@/lib/utils";

/**
 * Height of the flow panel. Shared by the 2D view, the 3D canvas and the
 * loading skeleton so switching modes never resizes the panel and reflows
 * the page beneath it.
 *
 * Do not raise these without widening the card too: at typical card widths
 * the camera fit is bound by WIDTH, so extra height is dead space under the
 * building. The xl step pays off only because the card is wide enough there
 * for the fit to become height-bound.
 */
export const POWER_FLOW_BOX = "h-[380px] sm:h-[440px] xl:h-[520px]";

// ssr:false keeps the WebGL scene out of the server bundle entirely, not
// merely unrendered on first paint.
//
// The import() must be written out in full here rather than delegated to
// use-scene-3d.ts: Next reads the module path straight out of this arrow
// function, and indirecting it hides it from that analysis. Two literal
// import()s of one specifier still resolve to a single shared chunk, so the
// warm-up in use-scene-3d genuinely warms this one.
const PowerFlowScene3D = dynamic(
  () => import("@/components/dashboard/fleet-3d-power-flow").then((m) => m.PowerFlowScene3D),
  {
    ssr: false,
    loading: () => <PowerFlowSkeleton />,
  },
);

/**
 * Below this width the panel is roughly 340px across, the camera fit becomes
 * width-bound, and the four callouts start overlapping the building they point
 * at. The scene RUNS fine on a phone; it just cannot be read on one.
 *
 * Deliberately the same threshold the prefetch policy uses, so the two agree:
 * there is no width at which we download the scene and then refuse to draw it,
 * or draw it having declined to prefetch.
 */
const SCENE_MIN_WIDTH = SCENE_PREFETCH_MIN_WIDTH;
const SCENE_WIDTH_QUERY = `(min-width: ${SCENE_MIN_WIDTH}px)`;

interface PowerFlowViewProps {
  /** The installation to draw. Fleet or single site — the scene cannot tell. */
  scene: PowerFlowScene;
  /**
   * The 2D diagram for this subject, which holds the panel while the scene
   * loads and replaces it entirely on small screens or without WebGL.
   *
   * A render prop rather than a node because the wrapper needs to hand it a
   * className: on the wall the outer class is `min-h-0 flex-1`, which only
   * means anything on a direct flex child, so the diagram has to fill a
   * wrapper instead of receiving that class itself.
   */
  renderFallback: (className: string) => React.ReactNode;
  mode: PowerFlowViewMode;
  /** Overrides the default panel height — the wall display fits it to the screen. */
  className?: string;
}

/**
 * The 2D diagram plus an optional corner note about what the 3D view is doing.
 *
 * The note matters because the swap is silent otherwise: someone who has just
 * pressed the 3D toggle sees the 2D diagram they were already looking at and
 * no evidence that anything happened, for as long as the chunk takes.
 */
function TwoDWithSceneNote({
  renderFallback,
  className,
  note,
}: {
  renderFallback: (className: string) => React.ReactNode;
  className?: string;
  note: "loading" | "failed" | null;
}) {
  if (note === null) return <>{renderFallback(className ?? "")}</>;

  return (
    <div className={cn("relative", className)}>
      {renderFallback("size-full")}

      {/* Sweeps the top edge of the panel while the chunk downloads.
          Deliberately on the EDGE rather than over the diagram: the numbers
          underneath are live and correct, and covering them to announce that
          a nicer picture is coming would trade real information for a
          placeholder. Sized for the wall display too — the previous 10px
          corner note was unreadable from across a room, so this pass is what
          actually makes the wait legible there. */}
      {note === "loading" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1 overflow-hidden rounded-t-lg bg-muted"
        >
          <div className="scene-load-sweep h-full w-1/5 rounded-full bg-primary/80" />
        </div>
      )}

      <span
        role="status"
        className={cn(
          "pointer-events-none absolute right-2 top-2.5 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur-sm",
          note === "loading" ? "bg-background/85 text-foreground" : "bg-muted/85 text-muted-foreground",
        )}
      >
        {note === "loading" ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Loading 3D view
          </>
        ) : (
          "3D view unavailable"
        )}
      </span>
    </div>
  );
}

/**
 * 2D or 3D power flow for one installation.
 *
 * Subject-agnostic: the fleet overview and a site detail page both mount this,
 * differing only in the PowerFlowScene they pass and the 2D diagram they fall
 * back to. That is what makes "one scene per site, no per-site scripts" true —
 * flow direction comes from lib/power-flow-model for every surface, so the
 * fleet view and a site view can never disagree about which way the grid
 * arrow points.
 */
export const PowerFlowView = memo(function PowerFlowView({
  scene,
  renderFallback,
  mode,
  className = POWER_FLOW_BOX,
}: PowerFlowViewProps) {
  const tier = useWebGLTier();
  // serverValue=false: assume too narrow until the client proves otherwise, so
  // a phone never mounts the canvas speculatively during hydration.
  const wideEnough = useMediaQuery(SCENE_WIDTH_QUERY);
  // Starts the download on mount when 3D is wanted and usable. Usually already
  // running by then — SceneWarmup kicks it off from above the auth gate.
  const scene3D = useScene3D(mode === "3d" && wideEnough);

  if (mode !== "3d") {
    return <>{renderFallback(className)}</>;
  }

  // TOO NARROW TO READ. Not a capability check — the scene renders perfectly
  // well on a phone, it just cannot be understood there. Returning the 2D
  // diagram silently, with no "loading" note, because nothing is loading and
  // nothing is coming: this IS the view on this device.
  if (!wideEnough) {
    return <>{renderFallback(className)}</>;
  }

  // No WebGL — a Smart TV browser that can't create a context would
  // otherwise render an unexplained blank panel. See use-webgl-support.ts.
  // `null` is the pre-hydration probe, which resolves on the first client
  // render, so it costs nothing to treat as "not yet".
  if (tier === "none") {
    return <>{renderFallback(className)}</>;
  }

  // 2D FIRST, 3D WHEN IT ARRIVES. The 2D diagram carries the wait rather than
  // a skeleton, because every number it draws is already in hand. This is also
  // what makes a scene on every site page cheap: the panel is never empty, so
  // a fresh WebGL context's mount cost is hidden rather than stared at.
  if (tier === null || scene3D !== "ready") {
    return (
      <TwoDWithSceneNote
        renderFallback={renderFallback}
        className={className}
        note={scene3D === "failed" ? "failed" : tier === null ? null : "loading"}
      />
    );
  }

  // Fades rather than cuts. The 2D diagram unmounts in the same commit, and a
  // hard swap between two quite different pictures reads as a glitch; the
  // dissolve also covers the canvas's first-frame shader compilation.
  //
  // Wrapped in an error boundary because the WebGL subtree is the largest
  // and least predictable thing the app mounts — a lost context, a driver
  // fault or a bad geometry prop would otherwise propagate to the route
  // boundary and take the whole dashboard down with it. Degrading to the 2D
  // diagram keeps every number on screen, which is what the panel is for.
  return (
    <ErrorBoundary
      resetKey={scene}
      fallback={
        <TwoDWithSceneNote renderFallback={renderFallback} className={className} note="failed" />
      }
    >
      <PowerFlowScene3D scene={scene} className={cn(className, "animate-in fade-in duration-500")} />
    </ErrorBoundary>
  );
});
