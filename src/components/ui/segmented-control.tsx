import * as SegmentedControlPrimitive from "@ui-sdk/react/segmented-control";
import * as React from "react";

import { cn } from "../../lib/cn";

function SegmentedControl({
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof SegmentedControlPrimitive.SegmentedControl>,
  "children"
> & { children?: React.ReactNode }) {
  return (
    <SegmentedControlPrimitive.SegmentedControl
      className={cn(
        "relative isolate inline-flex rounded-[3px] border border-input bg-background p-0.5",
        className,
      )}
      {...props}
    >
      <SegmentedControlPrimitive.SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-[2px] bg-muted shadow-[inset_0_0_0_1px_var(--color-input)]" />
      {children}
    </SegmentedControlPrimitive.SegmentedControl>
  );
}

function SegmentedControlItem({
  className,
  ...props
}: React.ComponentProps<
  typeof SegmentedControlPrimitive.SegmentedControlItem
>) {
  return (
    <SegmentedControlPrimitive.SegmentedControlItem
      className={cn(
        "min-h-6 border-0 bg-transparent px-2.5 py-0.5 text-muted-foreground disabled:opacity-40 aria-checked:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
