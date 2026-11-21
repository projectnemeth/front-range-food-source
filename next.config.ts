import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/pickup": [
      "./tools/pickup-station/Index.html",
      "./public/pickup-outbox.js",
    ],
  },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
