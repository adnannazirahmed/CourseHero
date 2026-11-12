import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["youtube-transcript"],
  distDir: process.env.COURSEIT_DIST_DIR || ".next",
};

export default nextConfig;
