import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.ERP_DESKTOP_BUILD === "true" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
