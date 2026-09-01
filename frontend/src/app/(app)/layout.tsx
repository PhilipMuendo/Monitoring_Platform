import { Suspense } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { RequireAuth } from "@/components/layout/require-auth";

// RequireAuth reads useSearchParams (to remember where to return after
// sign-in), which must sit under a Suspense boundary or it opts the whole
// route out of prerendering.
function AuthGateFallback() {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AuthGateFallback />}>
      <RequireAuth>
        <AppShell>{children}</AppShell>
      </RequireAuth>
    </Suspense>
  );
}
