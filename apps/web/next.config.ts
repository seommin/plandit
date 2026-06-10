import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@plandit/database", "@plandit/shared"],
};

export default nextConfig;
