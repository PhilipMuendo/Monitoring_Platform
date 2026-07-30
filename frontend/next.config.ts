import path from "node:path";
import type { NextConfig } from "next";

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
};

export default nextConfig;
