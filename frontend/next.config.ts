import path from "node:path";
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

/**
 * `ANALYZE=true npm run build` writes a treemap of every client chunk to
 * .next/analyze.
 *
 * Worth having wired up permanently: this app carries three.js, drei,
 * postprocessing, recharts and framer-motion, and the two things keeping the
 * initial payload sane — the single dynamic boundary around Recharts, and the
 * one shared scene chunk — are both invariants that a stray static import
 * silently breaks. Without a way to look, the regression is invisible until
 * someone on a slow connection complains.
 */
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly — otherwise Next.js walks up and
  // finds an unrelated package-lock.json in the user's home directory
  // and misdetects that as the monorepo root.
  turbopack: {
    root: path.join(__dirname),
  },
  // Standalone output bundles only the traced production dependencies into
  // .next/standalone, so the Docker runtime image doesn't need node_modules
  // (which include the three.js/recharts devDependency-heavy install).
  output: "standalone",

  async headers() {
    return [
      {
        // Everything under public/ is served with `public, max-age=0` by
        // default, so a returning visitor spends a round trip revalidating the
        // login photograph before it can paint — every single load, for a file
        // that changes about once a year.
        //
        // A week, deliberately not `immutable` with a one-year max-age: these
        // filenames carry a width, not a content hash, so a swapped photograph
        // would be pinned in every browser that had seen the old one. Seven
        // days is long enough that no real session ever revalidates and short
        // enough that a swap propagates on its own. If a swap ever needs to
        // land immediately, change the filename (…-1280-v2.webp) — that is
        // what makes a cache miss, not the header.
        source: "/images/:file*.webp",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
