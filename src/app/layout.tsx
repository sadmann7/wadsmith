import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans-condensed/400.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const description =
  "Build Doom maps in your browser, then play them in the real engine.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Wadsmith", template: "%s · Wadsmith" },
  description,
  applicationName: "Wadsmith",
  openGraph: {
    type: "website",
    siteName: "Wadsmith",
    title: "Wadsmith",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Wadsmith",
    description,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0e0d0c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
