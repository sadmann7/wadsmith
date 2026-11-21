import "./globals.css";

import type { Metadata, Viewport } from "next";
import * as React from "react";

import { fontMono, fontSans } from "@/lib/fonts";

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
  themeColor: "oklch(0.16 0.003 67.6)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
