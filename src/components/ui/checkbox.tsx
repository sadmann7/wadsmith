import * as CheckboxPrimitive from "@ui-sdk/react/checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/cn";

function Checkbox({
  className,
  ...props
}: Omit<React.ComponentProps<typeof CheckboxPrimitive.Checkbox>, "children">) {
  return (
    <CheckboxPrimitive.Checkbox
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-input/30 p-0 text-primary-foreground shadow-xs transition-colors disabled:opacity-50 aria-invalid:border-destructive data-[checked]:border-primary data-[checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.CheckboxIndicator className="grid place-content-center">
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.CheckboxIndicator>
    </CheckboxPrimitive.Checkbox>
  );
}

export { Checkbox };
