import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/pickup": ["./tools/pickup-station/Index.html"],
  },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
