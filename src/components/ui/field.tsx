import * as FieldPrimitive from "@ui-sdk/react/field";
import * as React from "react";

import { cn } from "../../lib/cn";

const fieldClass = "flex flex-col gap-1 [&_[data-slot=select-trigger]]:w-full";
const labelClass = "text-sm text-muted-foreground";

function Field({
  className,
  ...props
}: React.ComponentProps<typeof FieldPrimitive.Field>) {
  return (
    <FieldPrimitive.Field className={cn(fieldClass, className)} {...props} />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof FieldPrimitive.FieldLabel>) {
  return (
    <FieldPrimitive.FieldLabel
      className={cn(labelClass, className)}
      {...props}
    />
  );
}

function FieldItem({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn(fieldClass, className)} {...props} />;
}

function Label({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(labelClass, className)} {...props} />;
}

export { Field, FieldItem, FieldLabel, Label };
