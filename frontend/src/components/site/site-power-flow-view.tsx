"use client";

import { PowerFlowView } from "@/components/dashboard/power-flow-view";
import { SitePowerFlow } from "@/components/site/site-power-flow";
import type { PowerFlowViewMode } from "@/hooks/use-power-flow-view-mode";
import { sitePowerFlowScene } from "@/lib/power-flow-model";
import type { SiteWithStatus } from "@/lib/types";

/**
 * One site's power flow, 2D or 3D.
 *
 * The 3D house here is the SAME renderer the fleet overview uses, driven by
 * this site's own telemetry — not a copy, not a variant. There is no per-site
 * configuration anywhere: sitePowerFlowScene runs the same solarLeg / gridLeg /
 * loadLeg / batteryLeg functions the 2D diagram below it already used, so flow
 * direction is derived from this site's readings by the one tested module that
 * decides direction for every surface in the app.
 *
 * What that buys, concretely: adding a site is adding a row. Nothing about the
 * scene needs to know it exists.
 *
 * Honest limits, both handled inside PowerFlowView rather than here:
 *  - below 768px this renders the 2D diagram instead. The scene runs fine on a
 *    phone; its four callouts collide with the building at that width, so it
 *    cannot be READ on one.
 *  - a device with no WebGL gets the 2D diagram permanently.
 *
 * The scene costs no extra download. It is the same lazily-loaded chunk the
 * dashboard already fetches, resolved once per session and shared across every
 * route, so the hundredth site page is as cheap as the first.
 */
export function SitePowerFlowView({
  site,
  mode,
  className,
}: {
  site: SiteWithStatus;
  mode: PowerFlowViewMode;
  className?: string;
}) {
  return (
    <PowerFlowView
      scene={sitePowerFlowScene(site)}
      renderFallback={(c) => <SitePowerFlow site={site} className={c} />}
      mode={mode}
      className={className}
    />
  );
}
