import * as InputPrimitive from "@ui-sdk/react/input";
import * as React from "react";

import { cn } from "../../lib/cn";

type InputProps = React.ComponentProps<typeof InputPrimitive.Input>;

const variants = {
  default: "min-h-[30px] border-input px-2 py-1",
  ghost: "border-transparent px-1.5 hover:border-input",
};

function Input({
  variant = "default",
  className,
  ...props
}: InputProps & { variant?: keyof typeof variants }) {
  return (
    <InputPrimitive.Input
      className={cn(
        "w-full rounded-[3px] border bg-transparent",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

function InputGroup({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 rounded-[3px] border border-input px-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: InputProps) {
  return (
    <InputPrimitive.Input
      className={cn(
        "w-full min-w-0 border-0 bg-transparent outline-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input, InputGroup, InputGroupInput };
