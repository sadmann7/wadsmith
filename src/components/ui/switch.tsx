import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

function Switch({
  className,
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive>, "className" | "children"> & {
  className?: string;
}) {
  return (
    <SwitchPrimitive
      className={cn(
        "group inline-flex h-[18px] w-8 shrink-0 rounded-full border-0 bg-input p-0.5 data-[checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchThumb className="size-3.5 rounded-full bg-foreground group-data-[checked]:translate-x-3.5" />
    </SwitchPrimitive>
  );
}

export { Switch };
