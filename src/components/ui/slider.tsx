import {
  Slider as SliderPrimitive,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from "@ui-sdk/react/slider";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/cn";

function Slider({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SliderPrimitive>, "className" | "children"> & {
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <SliderPrimitive
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      {children}
      <SliderControl className="flex h-[18px] items-center">
        <SliderTrack className="relative h-1 w-full rounded-sm bg-input/50">
          <SliderIndicator className="h-full rounded-sm bg-primary" />
          <SliderThumb
            aria-label={label}
            className="size-3.5 rounded-full bg-foreground"
          />
        </SliderTrack>
      </SliderControl>
    </SliderPrimitive>
  );
}

export { Slider, SliderValue };
