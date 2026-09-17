import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep native/Node-heavy modules out of the bundler — require() them at runtime.
  serverExternalPackages: ["ssh2", "msedge-tts", "ogg-opus-decoder", "@wasm-audio-decoders/common", "@wasm-audio-decoders/opus-ml"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
