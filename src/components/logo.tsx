import type * as React from "react";

import { cn } from "@/lib/cn";

export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("fill-primary", className)}
      {...props}
    >
      <path
        className="fill-[color-mix(in_oklab,var(--color-primary)_76%,black)]"
        d="M27 14h10L26 50H16zm22 0h10L48 50H38z"
      />
      <path d="M5 14h10l11 36H16zm22 0h10l11 36H38z" />
    </svg>
  );
}
