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
            staleTime: 30_000,
            refetchOnWindowFocus: false,
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
