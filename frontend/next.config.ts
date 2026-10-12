import type { NextConfig } from "next";

const distDir=process.env.FRONTEND_BUILD_DIR||".next";
if(!/^\.next(?:-[a-z0-9-]+)?$/u.test(distDir))throw new Error("FRONTEND_BUILD_DIR must be a local .next[-name] directory");

const nextConfig: NextConfig = {
  distDir,
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
};

export default nextConfig;
