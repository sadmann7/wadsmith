import * as MenuPrimitive from "@ui-sdk/react/menu";
import * as React from "react";

import { cn } from "@/lib/cn";
import { itemClass, popupClass } from "./select";

function MenuContent({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.MenuContent>) {
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
}: React.ComponentProps<typeof MenuPrimitive.MenuItem> & {
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

function MenuRadioItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.MenuRadioItem>) {
  return (
    <MenuPrimitive.MenuRadioItem
      className={cn(itemClass, "data-[highlighted]:bg-accent", className)}
      {...props}
    />
  );
}

function MenuCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.MenuCheckboxItem>) {
  return (
    <MenuPrimitive.MenuCheckboxItem
      className={cn(itemClass, "data-[highlighted]:bg-accent", className)}
      {...props}
    />
  );
}

function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.MenuSeparator>) {
  return (
    <MenuPrimitive.MenuSeparator
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
};

export {
  createMenuController,
  Menu,
  MenuContextTrigger,
  MenuGroup,
  MenuGroupLabel,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuTrigger,
} from "@ui-sdk/react/menu";
