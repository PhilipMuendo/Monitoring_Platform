// Shared between the 2D SVG flow diagram and the 3D scene so "how active
// / how fast" never silently drifts apart between the two views.

export const POWER_FLOW_THRESHOLD_W = 150;

export function scalePowerFlowWidth(watts: number, maxWatts: number) {
  const min = 1.5;
  const max = 6;
  if (maxWatts <= 0) return min;
  return min + (Math.min(Math.abs(watts), maxWatts) / maxWatts) * (max - min);
}

export function scalePowerFlowSpeed(watts: number, maxWatts: number) {
  const min = 0.1;
  const max = 0.5;
  if (maxWatts <= 0) return min;
  return min + (Math.min(Math.abs(watts), maxWatts) / maxWatts) * (max - min);
}
