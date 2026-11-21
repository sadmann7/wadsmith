import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

function Alert({
  variant = "default",
  className,
  ...props
}: ComponentProps<"p"> & { variant?: "default" | "destructive" }) {
  return (
    <p
      className={cn(
        "rounded-[3px] border p-2.5 wrap-anywhere",
        variant === "destructive" ? "border-destructive" : "border-input",
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
