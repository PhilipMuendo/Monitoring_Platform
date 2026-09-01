import Link from "next/link";

/**
 * Deliberately plain markup rather than the shared <Button>.
 *
 * /_not-found is collected as a Server Component at build time with no client
 * boundary above it. Importing Button pulls in the `radix-ui` barrel, whose
 * modules call React.createContext at evaluation time, and the build fails
 * outright with "createContext is not a function". A styled <Link> needs none
 * of that, and this page has no interactivity to justify the dependency.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That address doesn&apos;t match anything in the platform. It may have been a site that has since been removed.
      </p>
      <Link
        href="/"
        className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
