import {
  AlertDialog,
  AlertDialogBackdrop as AlertDialogBackdropPrimitive,
  AlertDialogClose,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
} from "@ui-sdk/react/alert-dialog";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { backdropClass, contentClass, titleClass } from "./dialog";

type WithClass<P> = Omit<P, "className"> & { className?: string };

function AlertDialogBackdrop({
  className,
  ...props
}: WithClass<ComponentProps<typeof AlertDialogBackdropPrimitive>>) {
  return (
    <AlertDialogBackdropPrimitive
      className={cn(backdropClass, className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: WithClass<ComponentProps<typeof AlertDialogContentPrimitive>>) {
  return (
    <AlertDialogContentPrimitive
      className={cn(contentClass, "gap-3 p-5", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: WithClass<ComponentProps<typeof AlertDialogTitlePrimitive>>) {
  return (
    <AlertDialogTitlePrimitive
      className={cn(titleClass, className ?? "text-xl font-semibold")}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: WithClass<ComponentProps<typeof AlertDialogDescriptionPrimitive>>) {
  return (
    <AlertDialogDescriptionPrimitive
      className={cn("m-0 text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
};
