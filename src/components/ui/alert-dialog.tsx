import * as AlertDialogPrimitive from "@ui-sdk/react/alert-dialog";
import * as React from "react";

import { cn } from "@/lib/cn";

import { backdropClass, contentClass, titleClass } from "./dialog";

function AlertDialogBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.AlertDialogBackdrop>) {
  return (
    <AlertDialogPrimitive.AlertDialogBackdrop
      className={cn(backdropClass, className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.AlertDialogContent>) {
  return (
    <AlertDialogPrimitive.AlertDialogContent
      className={cn(contentClass, "gap-4 p-6", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.AlertDialogTitle>) {
  return (
    <AlertDialogPrimitive.AlertDialogTitle
      className={cn(titleClass, className ?? "text-xl font-semibold")}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.AlertDialogDescription>) {
  return (
    <AlertDialogPrimitive.AlertDialogDescription
      className={cn("m-0 text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
};

export { AlertDialog, AlertDialogClose } from "@ui-sdk/react/alert-dialog";
