/**
 * When it is acceptable to download the 3D scene SPECULATIVELY.
 *
 * The scene costs about 370 KB gzipped across three chunks (three.js + r3f,
 * drei, and the ambient-occlusion pass), and roughly 860 KB of JavaScript to
 * parse and compile before a single frame is drawn. That is a good trade on a
 * desk and a bad one on a phone on mobile data — so the decision cannot be a
 * single global "prefetch: on".
 *
 * TWO KINDS OF FETCH, and the distinction is the whole design:
 *
 *   EXPLICIT — the user pressed the 3D toggle, or their stored preference is
 *   being honoured on a screen where 3D is what will actually render. Their
 *   intent is known. The only veto is a device that cannot do WebGL at all,
 *   because there the bytes could never be used for anything.
 *
 *   SPECULATIVE — nobody asked yet; we are spending the user's bandwidth on a
 *   guess to make a later moment feel instant. A guess has to earn it, so
 *   every condition below is a veto.
 *
 * Encoded as a pure function on purpose: it is the kind of rule that is
 * impossible to test through a React tree and trivial to test directly, and
 * "what happens on Save Data" should be answerable without a browser.
 */

export type WebGLTierLike = "none" | "basic" | "full" | null;

/** The parts of navigator.connection we use. Absent on Safari and Firefox. */
export interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

export interface ScenePrefetchInput {
  tier: WebGLTierLike;
  /** navigator.connection, or undefined where the browser does not expose it. */
  connection?: ConnectionLike;
  viewportWidth: number;
}

/**
 * Below this width the flow panel is roughly 340 px across. The scene's own
 * camera fit becomes width-bound there (see lib/scene-camera.ts) and the four
 * callouts — Solar, Grid, Load, Battery — start overlapping the building they
 * point at. 3D on a phone is a legitimate CHOICE, and the toggle still honours
 * it, but it is not a good enough guess to spend someone's data plan on.
 *
 * Matches Tailwind's `md`, which is also where the dashboard grid goes
 * multi-column, so the threshold lines up with where the panel gets room.
 */
export const SCENE_PREFETCH_MIN_WIDTH = 768;

/** Connection classes where a speculative megabyte is indefensible. */
const SLOW_CONNECTIONS = new Set(["slow-2g", "2g"]);

/**
 * Whether the scene may be fetched before anyone has asked for it.
 *
 * Note this deliberately does NOT consider the stored view-mode preference.
 * A stored "3d" makes the fetch explicit, not speculative, and takes the
 * other path — see startScene3DLoad in hooks/use-scene-3d.ts.
 */
export function shouldPrefetchScene({ tier, connection, viewportWidth }: ScenePrefetchInput): boolean {
  // null is the pre-hydration probe result, not a verdict. Treated as "not
  // yet" rather than "no": the caller re-runs once the tier resolves, and
  // guessing "yes" here would defeat the WebGL veto entirely.
  if (tier === null || tier === "none") return false;

  // An explicit request from the user to stop spending their bytes. Honouring
  // it is not optional and there is no quality argument that outranks it.
  if (connection?.saveData) return false;

  if (connection?.effectiveType && SLOW_CONNECTIONS.has(connection.effectiveType)) return false;

  if (viewportWidth < SCENE_PREFETCH_MIN_WIDTH) return false;

  return true;
}

/** Reads navigator.connection without asserting it exists. Browser-only. */
export function currentConnection(): ConnectionLike | undefined {
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}
