"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { SceneWarmup } from "@/components/scene-warmup";
import { InstallPrompt } from "@/components/install-prompt";
import { ServiceWorker } from "@/components/service-worker";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Well under the polling cadence on purpose. When staleTime
            // equalled refetchInterval every scheduled poll was also a cache
            // miss, so nothing was ever served warm — a remount during a
            // route change refetched from scratch instead of painting the
            // data it already had. 10s keeps navigation instant while
            // guaranteeing anything older than that is refreshed.
            staleTime: 10_000,
            // ON, deliberately — this is a monitoring dashboard. Refocus is
            // the strongest available signal that someone wants to know the
            // fleet's state right now; leaving it off meant tabbing back
            // after a break and reading data up to 30s old (up to 5 minutes
            // for the day curve) with nothing on screen saying so.
            refetchOnWindowFocus: true,
            // Reconnecting after the laptop wakes or the LAN drops is the
            // other moment the cache is guaranteed to be wrong.
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {/* Above AuthProvider on purpose: the 3D scene chunk is public
            static JavaScript, so making its download wait on the auth
            refresh call put a whole round trip in front of the largest
            asset on the site for no reason. */}
        <SceneWarmup />
        {/* Both render nothing and both sit outside AuthProvider: caching and
            installability are properties of the app, not of a session, and a
            signed-out visitor on the login page is as entitled to install it
            as anyone. */}
        <ServiceWorker />
        <AuthProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <InstallPrompt />
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
