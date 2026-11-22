import { ImagePlus, Trash2 } from "lucide-react";
import * as React from "react";

import type { Resource } from "@/lib/engine/iwad";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readWadTextures } from "@/lib/wad/resources";

interface ResourcesDialogProps {
  resources: Resource[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function ResourcesDialog({
  resources,
  onAdd,
  onRemove,
  onClose,
}: ResourcesDialogProps) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[560px]">
        <DialogHeader>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle>Textures</DialogTitle>
            <DialogDescription>
              {resources.length === 0
                ? "None added"
                : `${resources.length} added`}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <p className="m-0 text-muted-foreground">
            Add a texture WAD, or images to turn into textures. Images take the
            game&apos;s palette and their file&apos;s name, and one of 64 by 64
            is a floor and ceiling flat as well. A built WAD carries only the
            ones its maps use.
          </p>
          {resources.length > 0 ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {resources.map((resource) => (
                <li
                  key={resource.id}
                  className="flex items-center justify-between gap-3 rounded-[3px] border border-border bg-card px-3 py-2"
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate">{resource.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {contentsOf(resource)}
                    </span>
                  </span>
                  <Button
                    aria-label={`Remove ${resource.name}`}
                    onClick={() => onRemove(resource.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter className="justify-between">
          <p className="m-0 min-w-0 text-muted-foreground">
            They stay in this browser.
          </p>
          <Button variant="primary" onClick={() => input.current?.click()}>
            <ImagePlus size={14} aria-hidden="true" />
            Add textures
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept=".wad,image/*"
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = "";
              if (files.length > 0) onAdd(files);
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function contentsOf(resource: Resource) {
  try {
    const { definitions, flats } = readWadTextures(resource.data);
    return `${counted(definitions.size, "texture")} · ${counted(flats.size, "flat")}`;
  } catch {
    return "Can't be read";
  }
}

function counted(total: number, one: string) {
  return `${total} ${total === 1 ? one : `${one}s`}`;
}
