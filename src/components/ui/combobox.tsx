import * as ComboboxPrimitive from "@ui-sdk/react/combobox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/cn";

import { itemClass, popupClass } from "./select";

function ComboboxInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ComboboxInput>) {
  return (
    <ComboboxPrimitive.ComboboxInput
      className={cn(
        "min-h-[30px] w-full min-w-0 rounded-[3px] border border-input bg-input/30 py-1 pr-7 pl-2.5 shadow-xs transition-[color,background-color,box-shadow] hover:not-disabled:bg-input/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ComboboxTrigger>) {
  return (
    <ComboboxPrimitive.ComboboxTrigger
      className={cn(
        "absolute inset-y-0 right-0 inline-flex w-7 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxContent({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ComboboxContent>) {
  return (
    <ComboboxPrimitive.ComboboxContent
      className={cn(popupClass, "min-w-(--anchor-width)", className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ComboboxItem>) {
  return (
    <ComboboxPrimitive.ComboboxItem
      className={cn(itemClass, "data-[highlighted]:bg-accent", className)}
      {...props}
    />
  );
}

function ComboboxLabel({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ComboboxLabel>) {
  return (
    <ComboboxPrimitive.ComboboxLabel
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ComboboxEmpty>) {
  return (
    <ComboboxPrimitive.ComboboxEmpty
      className={cn("px-2 py-1.5 text-muted-foreground", className)}
      {...props}
    />
  );
}

function ComboboxCheck() {
  return (
    <ComboboxPrimitive.ComboboxItemIndicator className="ml-auto pl-3 text-primary">
      <Check size={14} aria-hidden="true" />
    </ComboboxPrimitive.ComboboxItemIndicator>
  );
}

export {
  ComboboxCheck,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxTrigger,
};

export { Combobox, ComboboxList } from "@ui-sdk/react/combobox";
