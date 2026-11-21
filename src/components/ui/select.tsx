import {
  Select,
  SelectContent as SelectContentPrimitive,
  SelectGroup,
  SelectGroupLabel,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectLabel as SelectLabelPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue,
} from "@ui-sdk/react/select";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

type WithClass<P> = Omit<P, "className"> & {
  className?: string;
};

const popupClass =
  "z-20 max-h-(--available-height) overflow-y-auto rounded-[7px] border border-input bg-muted p-1 shadow-popover";

const itemClass = "flex items-center gap-2 rounded-[4px] px-2 py-[5px]";

function SelectTrigger({
  className,
  ...props
}: WithClass<ComponentProps<typeof SelectTriggerPrimitive>>) {
  return (
    <SelectTriggerPrimitive
      className={cn(
        "inline-flex min-h-[30px] cursor-default items-center justify-between gap-2 rounded-[3px] border border-input bg-transparent px-2.5 py-1 whitespace-nowrap hover:border-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SelectContent({
  className,
  ...props
}: WithClass<ComponentProps<typeof SelectContentPrimitive>>) {
  return (
    <SelectContentPrimitive
      className={cn(popupClass, "min-w-(--anchor-width)", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  ...props
}: WithClass<ComponentProps<typeof SelectItemPrimitive>>) {
  return (
    <SelectItemPrimitive
      className={cn(itemClass, "data-[highlighted]:bg-accent", className)}
      {...props}
    />
  );
}

function SelectLabel({
  className,
  ...props
}: WithClass<ComponentProps<typeof SelectLabelPrimitive>>) {
  return (
    <SelectLabelPrimitive
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectCheck() {
  return (
    <SelectItemIndicator className="ml-auto pl-3 text-primary">
      <Check size={14} aria-hidden="true" />
    </SelectItemIndicator>
  );
}

export {
  itemClass,
  popupClass,
  Select,
  SelectCheck,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
};
