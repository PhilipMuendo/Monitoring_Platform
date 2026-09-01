"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The shared "something broke" panel. Used by every error boundary in the
 * app so a failed 3D scene, a failed route and a failed chart all read the
 * same way.
 *
 * The message is deliberately not the raw Error text: an exception string is
 * noise to an operator watching a solar fleet. The digest/message is kept
 * behind a <details> for whoever is actually debugging.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "This section failed to render. The rest of the page is unaffected.",
  error,
  onRetry,
  className,
  compact = false,
}: {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center ${
        compact ? "" : "min-h-48"
      } ${className ?? ""}`}
    >
      <AlertTriangle className="size-8 text-status-critical" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      )}
      {error && (
        <details className="w-full max-w-lg text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">Technical details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-left font-mono text-xs text-muted-foreground">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        </details>
      )}
    </div>
  );
}
