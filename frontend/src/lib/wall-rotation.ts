/**
 * Page-rotation order for the wall display.
 *
 * Pure index arithmetic, kept out of the hook so the skip-empty rule is
 * unit-testable without a DOM — the same split as chart-series.ts.
 *
 * The rule that matters: a page with nothing to show is passed over rather
 * than displayed empty. An unattended screen holding on "no data" for half a
 * minute is dead wall time, and overnight — when the fleet is healthy and
 * least is happening — that would be most of the night.
 */
export interface RotatingPage {
  id: string;
  /** False when this page has nothing worth putting on screen right now. */
  ready: boolean;
  /** How long this page holds the screen before handing over. */
  dwellMs: number;
}

/**
 * First ready page at or after `from`, wrapping once. Null when no page is
 * ready at all — the caller decides what to do with an entirely empty wall
 * rather than this silently picking page 0.
 */
export function firstReadyIndex(pages: readonly RotatingPage[], from = 0): number | null {
  if (pages.length === 0) return null;
  const start = ((from % pages.length) + pages.length) % pages.length;
  for (let i = 0; i < pages.length; i++) {
    const idx = (start + i) % pages.length;
    if (pages[idx].ready) return idx;
  }
  return null;
}

/**
 * The next ready page strictly after `from`, wrapping.
 *
 * Falls back to `from` when nothing else is ready, so a single-ready-page wall
 * holds still instead of flickering against itself once per dwell.
 */
export function nextReadyIndex(pages: readonly RotatingPage[], from: number): number {
  if (pages.length === 0) return from;
  for (let i = 1; i <= pages.length; i++) {
    const idx = (((from + i) % pages.length) + pages.length) % pages.length;
    if (pages[idx].ready) return idx;
  }
  return from;
}

/**
 * Which page should actually be on screen, given the stored index.
 *
 * Guards the case where the page currently displayed goes empty underneath the
 * viewer — every site recovers while the wall is showing the alerts page, say.
 * Resolving during render rather than correcting in an effect means there is
 * never a frame showing the emptied page.
 */
export function resolveActiveIndex(pages: readonly RotatingPage[], index: number): number {
  if (pages.length === 0) return 0;
  const clamped = ((index % pages.length) + pages.length) % pages.length;
  if (pages[clamped].ready) return clamped;
  return firstReadyIndex(pages, 0) ?? 0;
}

/** How many pages are currently worth showing. Below 2, rotation is pointless. */
export function readyCount(pages: readonly RotatingPage[]): number {
  return pages.reduce((n, p) => (p.ready ? n + 1 : n), 0);
}
