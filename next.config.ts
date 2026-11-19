import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  headers() {
    return [
      {
        // Network games share memory between the page and the game worker,
        // which browsers only allow on a cross-origin isolated page.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        // The Freedoom version is in the file name, so its contents never change.
        source: "/engine/:file(freedoom-.+\\.wad\\.gz)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
