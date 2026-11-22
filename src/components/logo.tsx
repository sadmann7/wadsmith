import type * as React from "react";

import { cn } from "@/lib/cn";

// The handles are filled to hide the lines under them, so the fill has to
// match whatever the mark sits on.
export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("fill-card", className)}
      {...props}
    >
      <path
        d="M8 14l12 36 12-24 12 24 12-36"
        className="fill-none stroke-primary"
        strokeWidth={6}
        strokeLinejoin="bevel"
      />
      <path
        className="stroke-foreground"
        strokeWidth={4}
        d="M2.5 8.5h11v11h-11zM14.5 44.5h11v11h-11zM26.5 20.5h11v11h-11zM38.5 44.5h11v11h-11zM50.5 8.5h11v11h-11z"
      />
    </svg>
  );
}
