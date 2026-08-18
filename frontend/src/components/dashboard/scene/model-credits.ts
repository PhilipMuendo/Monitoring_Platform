/**
 * Attribution for bundled third-party 3D models.
 *
 * This exists to satisfy a licence, not to be tidy. A licence like CC BY
 * permits commercial use and modification but *requires* crediting the author
 * wherever the work appears, and a note in a markdown file inside the
 * repository is not attribution to the people looking at the dashboard — so
 * whatever is listed here is rendered on the 3D panel itself.
 *
 * THE LIST IS EMPTY, AND THE MECHANISM IS STILL LIVE. The scene is entirely
 * procedural: the one asset that ever shipped was a CC BY concept car, removed
 * along with its 4 MB download. The renderer in fleet-3d-power-flow.tsx still
 * maps over this array, so adding an entry here is all it takes for the credit
 * to reappear on screen.
 *
 * Keep this in sync with frontend/public/models/ATTRIBUTION.md. If a model is
 * removed, drop its entry; if one is added under a licence requiring
 * attribution, it must appear here before it ships.
 */
export interface ModelCredit {
  /** Filename under /public/models, so an entry can be traced to an asset. */
  file: string;
  title: string;
  author: string;
  licence: string;
  licenceUrl: string;
  sourceUrl: string;
}

export const MODEL_CREDITS: ModelCredit[] = [];

/** One-line credit, e.g. for a tooltip or an aria-label. */
export function creditLine(credit: ModelCredit): string {
  return `"${credit.title}" by ${credit.author}, licensed under ${credit.licence}`;
}
