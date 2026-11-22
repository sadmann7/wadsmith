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
        "group inline-flex h-[18px] w-8 shrink-0 rounded-full border-0 bg-input p-0.5 data-[checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.SwitchThumb className="size-3.5 rounded-full bg-foreground group-data-[checked]:translate-x-3.5" />
    </SwitchPrimitive.Switch>
  );
}

export { Switch };
