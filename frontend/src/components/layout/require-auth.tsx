"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { loginUrlFor } from "@/lib/safe-redirect";
import { useAuth } from "@/lib/auth-context";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    // Carries the current location through the sign-in round trip. A session
    // expiring while someone is on /sites/abc used to drop them at /login and
    // then at the dashboard, losing the page they were working on — every
    // time, including the deep links people paste to each other.
    const qs = searchParams.toString();
    router.replace(loginUrlFor(qs ? `${pathname}?${qs}` : pathname));
  }, [status, router, pathname, searchParams]);

  if (status !== "authenticated") {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">
          {status === "loading" ? "Checking your session" : "Redirecting to sign in"}
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
