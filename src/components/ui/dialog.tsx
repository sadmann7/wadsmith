import * as DialogPrimitive from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/cn";

type WithClass<P> = Omit<P, "className"> & { className?: string };

const backdropClass = "fixed inset-0 z-40 bg-scrim";
const contentClass =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-input bg-card outline-none";
const titleClass =
  "block shrink-0 font-sans tracking-normal text-foreground normal-case";

function DialogBackdrop({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof DialogPrimitive.DialogBackdrop>>) {
  return (
    <DialogPrimitive.DialogBackdrop
      className={cn(backdropClass, className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof DialogPrimitive.DialogContent>>) {
  return (
    <DialogPrimitive.DialogContent
      className={cn(contentClass, className)}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof DialogPrimitive.DialogTitle>>) {
  return (
    <DialogPrimitive.DialogTitle
      className={cn(titleClass, className ?? "text-xl font-semibold")}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof DialogPrimitive.DialogDescription>>) {
  return (
    <DialogPrimitive.DialogDescription
      className={cn(
        className ?? "truncate font-mono text-xs text-muted-foreground",
      )}
      {...props}
    />
  );
}

function DialogCloseButton() {
  return (
    <DialogPrimitive.DialogClose
      aria-label="Close"
      className="shrink-0 border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground"
    >
      <X size={16} aria-hidden="true" />
    </DialogPrimitive.DialogClose>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex items-center gap-3 border-t border-border px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  backdropClass,
  contentClass,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  titleClass,
};

export { Dialog, DialogClose } from "@ui-sdk/react/dialog";
