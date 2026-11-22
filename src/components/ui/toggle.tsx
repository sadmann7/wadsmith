import * as TogglePrimitive from "@ui-sdk/react/toggle";
import * as React from "react";

import { cn } from "@/lib/cn";

const groupVariants = {
  default: "flex gap-0.5",
  segmented: "grid gap-0.5 rounded-[3px] bg-muted p-[3px]",
};

const toggleVariants = {
  default:
    "hover:bg-muted hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
  outline:
    "border border-input shadow-xs hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
  segmented:
    "hover:text-foreground aria-pressed:bg-input/30 aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset",
};

function ToggleGroup({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.ToggleGroup> & {
  variant?: keyof typeof groupVariants;
}) {
  return (
    <TogglePrimitive.ToggleGroup
      className={cn(groupVariants[variant], className)}
      {...props}
    />
  );
}

function Toggle({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Toggle> & {
  variant?: keyof typeof toggleVariants;
}) {
  return (
    <TogglePrimitive.Toggle
      className={cn(
        "inline-flex min-h-[26px] cursor-default items-center justify-center gap-2 rounded-[2px] border-0 bg-transparent px-2 whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] disabled:opacity-50 data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        toggleVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Toggle, ToggleGroup };
