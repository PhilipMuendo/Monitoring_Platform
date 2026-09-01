"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where
 * `error.tsx` cannot help because the layout that would host it is the thing
 * that threw. It must therefore render its own <html>/<body>, and cannot use
 * any provider-dependent component — no theming, no design tokens, so the
 * styling here is deliberately inline and self-contained.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Collective Energy Africa</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
            The application failed to start. This is usually temporary — reloading will normally recover it.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #3f3f46",
              background: "transparent",
              color: "#fafafa",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.875rem",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#71717a", fontFamily: "monospace" }}>
              digest: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
