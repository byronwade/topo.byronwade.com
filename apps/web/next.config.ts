import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/demo-studio", destination: "/_topo-studio/index.html" },
      {
        source: "/demo-studio/:path*",
        destination: "/_topo-studio/index.html",
      },
    ];
  },
};

export default nextConfig;
