import * as React from "react";

import { cn } from "@/lib/cn";

interface AlertProps extends React.ComponentProps<"p"> {
  variant?: "default" | "destructive";
}

function Alert({ variant = "default", className, ...props }: AlertProps) {
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
