"use client";

import dynamic from "next/dynamic";
import { memo } from "react";

import { cn } from "@/lib/utils";
import type { SiteWithStatus } from "@/lib/types";

// Leaflet touches window/document, so it needs the same ssr:false treatment
// as the three.js scene in fleet-power-flow-view.tsx — the only other place
// a browser-only rendering library is loaded in this codebase.
const FleetMap = dynamic(() => import("@/components/dashboard/fleet-map").then((m) => m.FleetMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

function MapSkeleton({ className }: { className?: string }) {
  return <div className={cn("size-full animate-pulse rounded-lg bg-muted", className)} />;
}

interface FleetMapViewProps {
  sites: SiteWithStatus[] | undefined;
  /** Enables pan/zoom/marker hit-testing. Off for the wall — nobody is
   * standing at an unattended TV to drag a map. */
  interactive?: boolean;
  className?: string;
}

// useSites() hands back a fresh array identity every 30s poll; Leaflet
// marker updates are DOM mutations rather than virtual-DOM diffs, so
// memo avoids rebuilding markers on every poll that didn't actually change
// any site's coordinates or status.
export const FleetMapView = memo(function FleetMapView({
  sites,
  interactive = false,
  className,
}: FleetMapViewProps) {
  return <FleetMap sites={sites} interactive={interactive} className={className} />;
});
