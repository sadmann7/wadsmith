import * as DrawerPrimitive from "@ui-sdk/react/drawer";
import * as React from "react";

import { cn } from "@/lib/cn";

function DrawerBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.DrawerBackdrop>) {
  return (
    <DrawerPrimitive.DrawerBackdrop
      className={cn("fixed inset-0 bg-scrim", className)}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.DrawerContent>) {
  return (
    <DrawerPrimitive.DrawerContent
      className={cn(
        "h-full border-border bg-background text-foreground shadow-lg data-[side=left]:border-r data-[side=right]:border-l",
        className,
      )}
      {...props}
    />
  );
}

export { DrawerBackdrop, DrawerContent };

export {
  Drawer,
  DrawerClose,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/react/drawer";
