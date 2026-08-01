import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traces the minimal set of files/deps each route actually needs into
  // .next/standalone, so the production Docker image ships a pruned
  // server instead of the full (~1GB) node_modules tree.
  output: "standalone",
  // Pin the workspace root explicitly — otherwise Next.js walks up and
  // finds an unrelated package-lock.json in the user's home directory
  // and misdetects that as the monorepo root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
