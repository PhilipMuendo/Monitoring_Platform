"use client";

import { useState } from "react";
import { Sun } from "lucide-react";

/**
 * Where the Collective Energy Africa logo is expected.
 *
 * DROP THE FILE HERE AND NOTHING ELSE NEEDS EDITING — same one-file swap as
 * the login photograph. Until it exists this component renders the original
 * sun + wordmark instead, so the header is never broken or empty.
 *
 * What to supply, in order of preference:
 *
 *   1. `logo.svg` — vector, so it is sharp on the wall display's 4K panel as
 *      well as a laptop. Strongly preferred.
 *   2. `logo.png` — transparent background, at least 3x the rendered height
 *      (so ~120px tall for the 40px slot here).
 *
 * It must have a TRANSPARENT background and light artwork. The header is the
 * brand's own near-black green (--brand, #0b1e0b), so a logo exported on its
 * own dark plate will show as a slightly-wrong rectangle sitting on an
 * almost-matching one, which reads worse than no logo at all. The 260x100
 * screenshot from the brand sheet has that plate baked in and is not usable
 * for this.
 *
 * ONE VARIANT IS ENOUGH TODAY, but only because every surface this renders on
 * is dark in both themes — the app header (--brand) and the login page. The
 * wall display deliberately does not use it: that header sits on --background,
 * which is white under the light theme, where light artwork would vanish.
 * Putting the logo there needs a second, dark-artwork export.
 */
const LOGO_SRC = "/images/logo.svg";

/**
 * The header wordmark.
 *
 * Falls back rather than gambling: a missing asset costs one 404 on first
 * load and then the original mark, instead of a broken-image glyph in the
 * corner of every page. Once the file is in place the fallback never runs.
 */
export function BrandLogo({ className }: { className?: string }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span className={className}>
        <span className="flex items-center gap-2">
          <Sun className="size-5 text-brand-accent" />
          <span className="hidden sm:inline">Solar Fleet Monitor</span>
        </span>
      </span>
    );
  }

  return (
    // A single fixed-size logo with a runtime existence fallback: next/image
    // cannot express the onError path, and would put the runtime optimizer in
    // front of an asset that may not be there at all.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt="Collective Energy Africa"
      className={className ? `h-8 w-auto ${className}` : "h-8 w-auto"}
      onError={() => setMissing(true)}
    />
  );
}
