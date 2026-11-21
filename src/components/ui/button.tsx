import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

const variants = {
  default:
    "border border-input bg-transparent hover:not-disabled:border-muted-foreground",
  primary:
    "border border-transparent bg-primary font-semibold text-primary-foreground",
  destructive:
    "border border-destructive bg-transparent text-destructive hover:not-disabled:bg-destructive/15",
  outline:
    "border border-input bg-card hover:not-disabled:border-muted-foreground",
  ghost:
    "border border-transparent bg-transparent hover:not-disabled:bg-accent",
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
    "inline-flex cursor-default items-center justify-center rounded-[3px] whitespace-nowrap disabled:opacity-45",
    variant !== "text" && sizes[size],
    variants[variant],
    className,
  );
}

function Button({
  variant,
  size,
  className,
  ...props
}: Omit<ComponentProps<typeof ButtonPrimitive>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <ButtonPrimitive
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonSize, type ButtonVariant };
