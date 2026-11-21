import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <div className="grid max-w-[360px] justify-items-start gap-3">
        <p className="m-0 font-mono text-xs tracking-wide text-muted-foreground uppercase">
          404
        </p>
        <h1 className="m-0 text-2xl font-bold">This page doesn&apos;t exist</h1>
        <p className="m-0 text-muted-foreground">
          The link may be old, or the address has a typo.
        </p>
        <Link href="/" className="button primary mt-2 no-underline">
          Go to Wadsmith
        </Link>
      </div>
    </main>
  );
}
