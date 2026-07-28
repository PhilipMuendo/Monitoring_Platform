import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly — otherwise Next.js walks up and
  // finds an unrelated package-lock.json in the user's home directory
  // and misdetects that as the monorepo root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
