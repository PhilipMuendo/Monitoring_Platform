import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A stack of placeholder rows. Replaces the `[...Array(n)].map()` block that
 * had been copied into five files with slightly different heights and spacing.
 *
 * `role="status"` with an sr-only label because a loading state that is
 * purely visual announces nothing at all — a screen reader user got silence
 * between pressing a link and the content arriving.
 */
export function SkeletonList({
  count = 4,
  className,
  gap = "space-y-2",
  label = "Loading",
}: {
  /** Number of placeholder rows. */
  count?: number;
  /** Applied to each row — typically a height, e.g. "h-10". */
  className?: string;
  gap?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={gap}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("w-full", className)} aria-hidden="true" />
      ))}
    </div>
  );
}
