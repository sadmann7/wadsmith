import * as SliderPrimitive from "@ui-sdk/react/slider";
import * as React from "react";

import { cn } from "@/lib/cn";

function Slider({
  label,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof SliderPrimitive.Slider>, "children"> & {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <SliderPrimitive.Slider
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      {children}
      <SliderPrimitive.SliderControl className="flex h-[18px] items-center">
        <SliderPrimitive.SliderTrack className="relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.SliderIndicator className="h-full rounded-full bg-primary" />
          <SliderPrimitive.SliderThumb
            aria-label={label}
            className="size-4 rounded-full border border-primary bg-foreground shadow-sm transition-[box-shadow] hover:ring-4 hover:ring-ring/50 data-[dragging]:ring-4 data-[dragging]:ring-ring/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
          />
        </SliderPrimitive.SliderTrack>
      </SliderPrimitive.SliderControl>
    </SliderPrimitive.Slider>
  );
}

export { Slider };

export { SliderValue } from "@ui-sdk/react/slider";
