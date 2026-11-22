import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
  env: {
    // Co-op players must run the same build, so rooms compare this.
    NEXT_PUBLIC_APP_VERSION:
      process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
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
