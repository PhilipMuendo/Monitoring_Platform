import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder shaped like the power-flow diagram (a hub with four
 * satellites) rather than a bare rectangle, so the panel keeps its layout
 * and the wait reads as "loading this specific thing" instead of "blank".
 * Used both while the fleet summary is fetching and while the WebGL bundle
 * for the 3D view downloads.
 */
export function PowerFlowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-[320px] w-full sm:h-[380px]", className)} aria-hidden>
      {/* Solar — top */}
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2">
        <Skeleton className="size-14 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>

      {/* Grid — left */}
      <div className="absolute left-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-3 w-10" />
      </div>

      {/* Load — right */}
      <div className="absolute right-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-3 w-10" />
      </div>

      {/* Battery — bottom */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-3 w-10" />
      </div>

      {/* Hub — centre */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}
