import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep native/Node-heavy modules out of the bundler — require() them at runtime.
  serverExternalPackages: ["ssh2", "msedge-tts", "ogg-opus-decoder", "@wasm-audio-decoders/common", "@wasm-audio-decoders/opus-ml"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        // The app shell is a fully client-rendered SPA — HTML must never be
        // long-cached by intermediaries (the space-z edge proxy otherwise
        // pins s-maxage=1y and serves hours-old builds). Hashed
        // /_next/static assets keep their immutable caching untouched.
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
