"use client";

import Link from "next/link";
import { MonitorPlay } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Minimum viewport the wall display is honest at.
 *
 * WIDTH 1280 is not a taste call — it is the `xl` breakpoint the wall's own
 * layout is built on. Below it the overview grid collapses from four columns
 * to one, which stacks the power-flow card above "Needs Attention" inside an
 * `h-screen overflow-hidden` page. Everything past the first card is then off
 * screen with no scrollbar, on a route whose entire premise is that nobody is
 * standing there to scroll.
 *
 * HEIGHT 640 exists because width alone lets a phone in landscape through:
 * ~844x390 passes any sane width test and has less vertical room than a
 * calculator. The wall spends a fixed ~110px on its header and stale banner
 * before the scene gets anything, so under 640 the 3D panel falls below the
 * size at which its callouts stop colliding.
 *
 * What passes: 1080p and 4K wall panels (the actual target), and ordinary
 * laptops from 1280x800 up. What does not: phones in either orientation, and
 * tablets below iPad-Pro-landscape. Those get the dashboard, which is built
 * to be responsive; the wall never was and pretending otherwise would ship a
 * broken page rather than an honest one.
 */
export const WALL_MIN_WIDTH = 1280;
export const WALL_MIN_HEIGHT = 640;
/** Exported so SceneWarmup can ask the same question before prefetching. */
export const WALL_QUERY = `(min-width: ${WALL_MIN_WIDTH}px) and (min-height: ${WALL_MIN_HEIGHT}px)`;

/**
 * Renders `children` only on a screen large enough for them.
 *
 * The gate is a MOUNT boundary, not a visibility one. Below the threshold the
 * wall's component tree never runs, so the 3D scene chunk is never requested
 * and the SSE alert stream is never opened — which is the point: the device
 * most likely to fail this check is also the one most likely to be paying for
 * its bandwidth by the megabyte.
 */
export function WallSizeGate({ children }: { children: React.ReactNode }) {
  // serverValue=false: assume too small until the client proves otherwise, so
  // the expensive branch can never mount speculatively. See use-media-query.
  const bigEnough = useMediaQuery(WALL_QUERY);

  if (!bigEnough) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <MonitorPlay className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold">Made for the big screen</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            The wall display is a kiosk view laid out for a {WALL_MIN_WIDTH}px-wide
            screen or wider. On a phone or tablet the dashboard shows the same fleet
            data, sized for the device you are on.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Go to the dashboard</Link>
        </Button>
        {/* Not a dead end for the one legitimate case: someone setting the TV
            up from a laptop that is merely a little short. Rotating or
            full-screening is often all it takes, and the numbers are on
            screen so they can tell which axis is failing. */}
        <p className="text-xs text-muted-foreground">
          Needs at least {WALL_MIN_WIDTH} x {WALL_MIN_HEIGHT} px.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
