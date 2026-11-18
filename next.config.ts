import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  headers() {
    return [
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
