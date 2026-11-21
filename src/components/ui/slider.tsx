import * as SliderPrimitive from "@ui-sdk/react/slider";
import * as React from "react";

import { cn } from "../../lib/cn";

function Slider({
  label,
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof SliderPrimitive.Slider>,
  "className" | "children"
> & {
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <SliderPrimitive.Slider
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      {children}
      <SliderPrimitive.SliderControl className="flex h-[18px] items-center">
        <SliderPrimitive.SliderTrack className="relative h-1 w-full rounded-sm bg-input/50">
          <SliderPrimitive.SliderIndicator className="h-full rounded-sm bg-primary" />
          <SliderPrimitive.SliderThumb
            aria-label={label}
            className="size-3.5 rounded-full bg-foreground"
          />
        </SliderPrimitive.SliderTrack>
      </SliderPrimitive.SliderControl>
    </SliderPrimitive.Slider>
  );
}

export { Slider };

export { SliderValue } from "@ui-sdk/react/slider";
