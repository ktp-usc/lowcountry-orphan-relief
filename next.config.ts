import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Prisma's generated files import "./enums.js" but the real files are .ts
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;