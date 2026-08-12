/**
 * Attribution for bundled third-party 3D models.
 *
 * This exists to satisfy a licence, not to be tidy. The car in the undercroft
 * is CC BY 4.0, which permits commercial use and modification but *requires*
 * crediting the author wherever the work appears. A note in a markdown file
 * inside the repository is not attribution to the people looking at the
 * dashboard, so the credit is rendered in the app as well.
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

export const MODEL_CREDITS: ModelCredit[] = [
  {
    file: "car.glb",
    title: "CarConcept",
    author: "Eric Chadwick / Darmstadt Graphics Group GmbH",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept",
  },
];

/** One-line credit, e.g. for a tooltip or an aria-label. */
export function creditLine(credit: ModelCredit): string {
  return `"${credit.title}" by ${credit.author}, licensed under ${credit.licence}`;
}
