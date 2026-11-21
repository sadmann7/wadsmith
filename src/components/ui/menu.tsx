import {
  createMenuController,
  Menu,
  MenuContent as MenuContentPrimitive,
  MenuContextTrigger,
  MenuGroup,
  MenuGroupLabel,
  MenuItem as MenuItemPrimitive,
  MenuSeparator as MenuSeparatorPrimitive,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { itemClass, popupClass } from "./select";

type WithClass<P> = Omit<P, "className"> & {
  className?: string;
};

function MenuContent({
  className,
  ...props
}: WithClass<ComponentProps<typeof MenuContentPrimitive>>) {
  return (
    <MenuContentPrimitive className={cn(popupClass, className)} {...props} />
  );
}

function MenuItem({
  variant = "default",
  className,
  ...props
}: WithClass<ComponentProps<typeof MenuItemPrimitive>> & {
  variant?: "default" | "destructive";
}) {
  return (
    <MenuItemPrimitive
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
}: WithClass<ComponentProps<typeof MenuSeparatorPrimitive>>) {
  return (
    <MenuSeparatorPrimitive
      className={cn("my-1 h-px bg-input/30", className)}
      {...props}
    />
  );
}

export {
  createMenuController,
  Menu,
  MenuContent,
  MenuContextTrigger,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
};
