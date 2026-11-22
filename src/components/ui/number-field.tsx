import * as NumberInputPrimitive from "@ui-sdk/react/number-input";
import * as React from "react";

import { cn } from "@/lib/cn";

const stepClass =
  "border-0 bg-transparent text-muted-foreground transition-colors hover:not-disabled:bg-input/50 hover:not-disabled:text-foreground disabled:opacity-50";

interface NumberFieldProps extends Omit<
  React.ComponentProps<typeof NumberInputPrimitive.NumberInput>,
  "className" | "children"
> {
  label: string;
  className?: string;
  placeholder?: string;
}

function NumberField({
  label,
  className,
  placeholder,
  ...props
}: NumberFieldProps) {
  return (
    <NumberInputPrimitive.NumberInput {...props}>
      <NumberInputPrimitive.NumberInputGroup
        className={cn(
          "grid min-h-[30px] w-full grid-cols-[26px_minmax(0,1fr)_26px] overflow-hidden rounded-[3px] border border-input bg-input/30 shadow-xs has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring [&_:focus-visible]:outline-none",
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
          placeholder={placeholder}
          className="w-full min-w-0 border-0 bg-transparent text-center tabular-nums placeholder:text-muted-foreground"
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
