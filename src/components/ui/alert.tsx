import * as React from "react";

import { cn } from "@/lib/cn";

function Alert({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<"p"> & { variant?: "default" | "destructive" }) {
  return (
    <p
      className={cn(
        "rounded-lg border bg-card px-4 py-3 wrap-anywhere",
        variant === "destructive"
          ? "border-destructive/50 text-destructive"
          : "border-border",
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
