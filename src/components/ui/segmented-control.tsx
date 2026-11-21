import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlIndicator,
  SegmentedControlItem as SegmentedControlItemPrimitive,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/cn";

type WithClass<P> = Omit<P, "className"> & { className?: string };

function SegmentedControl({
  className,
  children,
  ...props
}: Omit<
  WithClass<ComponentProps<typeof SegmentedControlPrimitive>>,
  "children"
> & { children?: ReactNode }) {
  return (
    <SegmentedControlPrimitive
      className={cn(
        "relative isolate inline-flex rounded-[3px] border border-input bg-background p-0.5",
        className,
      )}
      {...props}
    >
      <SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-[2px] bg-muted shadow-[inset_0_0_0_1px_var(--color-input)]" />
      {children}
    </SegmentedControlPrimitive>
  );
}

function SegmentedControlItem({
  className,
  ...props
}: WithClass<ComponentProps<typeof SegmentedControlItemPrimitive>>) {
  return (
    <SegmentedControlItemPrimitive
      className={cn(
        "min-h-6 border-0 bg-transparent px-2.5 py-0.5 text-muted-foreground disabled:opacity-40 aria-checked:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
