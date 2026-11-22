import * as InputPrimitive from "@ui-sdk/react/input";
import * as React from "react";

import { cn } from "@/lib/cn";

type InputProps = React.ComponentProps<typeof InputPrimitive.Input>;

const variants = {
  default: "min-h-[30px] border-input bg-input/30 px-2 py-1 shadow-xs",
  ghost: "border-transparent bg-transparent px-1.5 hover:border-input",
};

function Input({
  variant = "default",
  className,
  ...props
}: InputProps & { variant?: keyof typeof variants }) {
  return (
    <InputPrimitive.Input
      className={cn(
        "w-full min-w-0 rounded-[3px] border transition-colors placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive",
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
        "flex items-center gap-2 rounded-[3px] border border-input bg-input/30 px-2 shadow-xs has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring",
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
        "w-full min-w-0 border-0 bg-transparent outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Input, InputGroup, InputGroupInput };
