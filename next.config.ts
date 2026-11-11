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
  async headers() {
    return [
      {
        // The dashboard is private: don't let the browser keep a copy
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;