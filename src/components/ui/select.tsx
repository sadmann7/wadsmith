import * as SelectPrimitive from "@ui-sdk/react/select";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/cn";

const popupClass =
  "z-20 max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-md border border-border bg-popover p-1 text-foreground shadow-popover transition-[opacity,scale] duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";

const itemClass =
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";

function SelectTrigger({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.SelectTrigger>) {
  return (
    <SelectPrimitive.SelectTrigger
      className={cn(
        "inline-flex min-h-[30px] cursor-default items-center justify-between gap-2 rounded-[3px] border border-input bg-input/30 px-2.5 py-1 whitespace-nowrap shadow-xs transition-[color,background-color,box-shadow] hover:not-disabled:bg-input/50 disabled:opacity-50 data-[placeholder]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SelectContent({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.SelectContent>) {
  return (
    <SelectPrimitive.SelectContent
      className={cn(popupClass, "min-w-(--anchor-width)", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.SelectItem>) {
  return (
    <SelectPrimitive.SelectItem
      className={cn(itemClass, "data-[highlighted]:bg-accent", className)}
      {...props}
    />
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.SelectLabel>) {
  return (
    <SelectPrimitive.SelectLabel
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectCheck() {
  return (
    <SelectPrimitive.SelectItemIndicator className="ml-auto pl-3 text-primary">
      <Check size={14} aria-hidden="true" />
    </SelectPrimitive.SelectItemIndicator>
  );
}

export {
  itemClass,
  popupClass,
  SelectCheck,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
};

export {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectValue,
} from "@ui-sdk/react/select";
