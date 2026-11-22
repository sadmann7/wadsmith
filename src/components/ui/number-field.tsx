import * as NumberInputPrimitive from "@ui-sdk/react/number-input";
import * as React from "react";

import { cn } from "@/lib/cn";

const stepClass =
  "border-0 bg-transparent text-muted-foreground hover:not-disabled:bg-accent hover:not-disabled:text-foreground disabled:opacity-40";

function NumberField({
  label,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof NumberInputPrimitive.NumberInput>,
  "className" | "children"
> & {
  label: string;
  className?: string;
}) {
  return (
    <NumberInputPrimitive.NumberInput {...props}>
      <NumberInputPrimitive.NumberInputGroup
        className={cn(
          "grid min-h-[30px] w-full grid-cols-[26px_minmax(0,1fr)_26px] overflow-hidden rounded-[3px] border border-input has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring [&_:focus-visible]:outline-none",
          className,
        )}
      >
        <NumberInputPrimitive.NumberInputDecrement
          aria-label={`Lower ${label}`}
          className={stepClass}
        >
          −
        </NumberInputPrimitive.NumberInputDecrement>
        <NumberInputPrimitive.NumberInputControl
          aria-label={label}
          className="w-full min-w-0 border-0 bg-transparent text-center tabular-nums"
        />
        <NumberInputPrimitive.NumberInputIncrement
          aria-label={`Raise ${label}`}
          className={stepClass}
        >
          +
        </NumberInputPrimitive.NumberInputIncrement>
      </NumberInputPrimitive.NumberInputGroup>
    </NumberInputPrimitive.NumberInput>
  );
}

export { NumberField };
