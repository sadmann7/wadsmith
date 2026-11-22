import * as SwitchPrimitive from "@ui-sdk/react/switch";
import * as React from "react";

import { cn } from "@/lib/cn";

function Switch({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive.Switch>, "children">) {
  return (
    <SwitchPrimitive.Switch
      className={cn(
        "group inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent bg-input/80 shadow-xs transition-colors disabled:opacity-50 data-[checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.SwitchThumb className="size-4 rounded-full bg-foreground transition-transform group-data-[checked]:translate-x-3.5 group-data-[checked]:bg-primary-foreground" />
    </SwitchPrimitive.Switch>
  );
}

export { Switch };
