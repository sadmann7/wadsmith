import type * as React from "react";

import { cn } from "@/lib/cn";

// The handle is filled to cover the W under it, so the fill has to match
// whatever the mark sits on.
export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("fill-card", className)}
      {...props}
    >
      <path
        className="fill-primary"
        d="M3 12h14l5 20 5-14h10l5 14 5-20h14L50 52H37l-5-16-5 16H14z"
      />
      <path
        className="stroke-foreground"
        strokeWidth={4}
        d="M27 13h10v10H27z"
      />
    </svg>
  );
}
