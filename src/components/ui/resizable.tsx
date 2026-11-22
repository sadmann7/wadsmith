import * as ResizablePrimitive from "@ui-sdk/react/resizable";
import * as React from "react";

import { cn } from "@/lib/cn";

function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.ResizableHandle>) {
  return (
    <ResizablePrimitive.ResizableHandle
      className={cn(
        "relative z-10 w-px bg-border transition-colors focus-visible:bg-ring data-[dragging]:bg-ring data-[hovering]:bg-ring",
        className,
      )}
      {...props}
    />
  );
}

export { ResizableHandle };

export { Resizable, ResizablePanel } from "@ui-sdk/react/resizable";
