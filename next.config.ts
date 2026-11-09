import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep this explicit while webpack customization is still in use.
  turbopack: {},
  webpack: (config) => {
    // Prisma's generated files import "./enums.js" but the real files are .ts
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;