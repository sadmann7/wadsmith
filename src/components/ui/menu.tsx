import * as MenuPrimitive from "@ui-sdk/react/menu";
import * as React from "react";

import { cn } from "../../lib/cn";
import { itemClass, popupClass } from "./select";

type WithClass<P> = Omit<P, "className"> & {
  className?: string;
};

function MenuContent({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof MenuPrimitive.MenuContent>>) {
  return (
    <MenuPrimitive.MenuContent
      className={cn(popupClass, className)}
      {...props}
    />
  );
}

function MenuItem({
  variant = "default",
  className,
  ...props
}: WithClass<React.ComponentProps<typeof MenuPrimitive.MenuItem>> & {
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.MenuItem
      className={cn(
        itemClass,
        variant === "destructive"
          ? "text-destructive data-[highlighted]:bg-destructive/15"
          : "data-[highlighted]:bg-accent",
        "[&_[data-slot=menu-shortcut]]:ml-auto [&_[data-slot=menu-shortcut]]:pl-4 [&_[data-slot=menu-shortcut]]:font-mono [&_[data-slot=menu-shortcut]]:text-xs [&_[data-slot=menu-shortcut]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function MenuSeparator({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof MenuPrimitive.MenuSeparator>>) {
  return (
    <MenuPrimitive.MenuSeparator
      className={cn("my-1 h-px bg-input/30", className)}
      {...props}
    />
  );
}

export { MenuContent, MenuItem, MenuSeparator };

export {
  createMenuController,
  Menu,
  MenuContextTrigger,
  MenuGroup,
  MenuGroupLabel,
  MenuTrigger,
} from "@ui-sdk/react/menu";
