import {
  Field as FieldPrimitive,
  FieldLabel as FieldLabelPrimitive,
} from "@ui-sdk/react/field";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

const fieldClass = "flex flex-col gap-1 [&_[data-slot=select-trigger]]:w-full";
const labelClass = "text-sm text-muted-foreground";

function Field({
  className,
  ...props
}: Omit<ComponentProps<typeof FieldPrimitive>, "className"> & {
  className?: string;
}) {
  return <FieldPrimitive className={cn(fieldClass, className)} {...props} />;
}

function FieldLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof FieldLabelPrimitive>, "className"> & {
  className?: string;
}) {
  return (
    <FieldLabelPrimitive className={cn(labelClass, className)} {...props} />
  );
}

function FieldItem({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(fieldClass, className)} {...props} />;
}

function Label({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn(labelClass, className)} {...props} />;
}

export { Field, FieldItem, FieldLabel, Label };
