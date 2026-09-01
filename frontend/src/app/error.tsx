"use client";

import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

/**
 * Route-level boundary. Next renders this in place of the page when any
 * client component under it throws, keeping the root layout — and so the
 * header and navigation — mounted.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-16">
      <ErrorState
        title="This page failed to load"
        description="An unexpected error stopped this page from rendering. Retrying is usually enough; if it keeps happening the backend may be unreachable."
        error={error}
        onRetry={reset}
      />
      <Button variant="ghost" size="sm" asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
