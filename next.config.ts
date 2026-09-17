import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep native/Node-heavy modules out of the bundler — require() them at runtime.
  serverExternalPackages: ["ssh2", "msedge-tts"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
