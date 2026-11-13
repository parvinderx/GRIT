import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DB-backed prototype: render dynamically, no PPR/cacheComponents complexity.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
