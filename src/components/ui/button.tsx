import * as ButtonPrimitive from "@ui-sdk/react/button";
import * as React from "react";

import { cn } from "@/lib/cn";

const variants = {
  default:
    "border border-input bg-input/30 shadow-xs hover:not-disabled:bg-input/50",
  primary:
    "border border-transparent bg-primary font-semibold text-primary-foreground shadow-xs hover:not-disabled:bg-primary/90",
  destructive:
    "border border-transparent bg-destructive/10 text-destructive hover:not-disabled:bg-destructive/15",
  outline: "border border-input bg-card shadow-xs hover:not-disabled:bg-accent",
  ghost:
    "border border-transparent bg-transparent hover:not-disabled:bg-accent/50",
  text: "border-0 bg-transparent px-0 py-0.5 text-muted-foreground hover:text-foreground aria-expanded:text-foreground",
};

const sizes = {
  default: "min-h-8 gap-1.5 px-2.5 py-1",
  icon: "size-[30px] p-0 text-muted-foreground hover:not-disabled:text-foreground",
};

type ButtonVariant = keyof typeof variants;
type ButtonSize = keyof typeof sizes;

function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 cursor-default items-center justify-center rounded-[3px] whitespace-nowrap transition-colors disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variant !== "text" && sizes[size],
    variants[variant],
    className,
  );
}

interface ButtonProps extends React.ComponentProps<
  typeof ButtonPrimitive.Button
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive.Button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonSize, type ButtonVariant };
