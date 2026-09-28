import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "mammoth"],
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
