import * as React from "react";

import type { GameMap } from "@/lib/map/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldItem } from "@/components/ui/field";
import {
  Select,
  SelectCheck,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findChoices, findKeys, type FindKind } from "@/lib/map/similar";

const kinds: { value: FindKind; label: string }[] = [
  { value: "wall", label: "Wall texture" },
  { value: "flat", label: "Floor or ceiling" },
  { value: "tag", label: "Tag" },
  { value: "action", label: "Line action" },
  { value: "thing", label: "Thing type" },
];

interface FindDialogProps {
  map: GameMap;
  onSelect: (kind: FindKind, keys: string[]) => void;
  onClose: () => void;
}

export function FindDialog({ map, onSelect, onClose }: FindDialogProps) {
  const [kind, setKind] = React.useState<FindKind>("wall");
  const choices = React.useMemo(() => findChoices(map, kind), [map, kind]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const value =
    picked && choices.some((choice) => choice.value === picked)
      ? picked
      : (choices[0]?.value ?? null);
  const count = choices.find((choice) => choice.value === value)?.count ?? 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[380px]">
        <DialogHeader>
          <DialogTitle>Find and select</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value) return;
            onSelect(kind, findKeys(map, kind, value));
            onClose();
          }}
        >
          <div className="grid gap-4 p-5">
            <Picker
              label="Look for"
              value={kind}
              items={kinds}
              onChange={(next) => {
                setKind(next as FindKind);
                setPicked(null);
              }}
            />
            {value ? (
              <Picker
                label="Which"
                value={value}
                items={choices.map((choice) => ({
                  value: choice.value,
                  label: `${choice.label} · ${choice.count}`,
                }))}
                onChange={setPicked}
              />
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                The map has none of these.
              </p>
            )}
          </div>
          <DialogFooter className="justify-end">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={!value}>
              {value ? `Select ${count}` : "Select"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface PickerProps {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}

function Picker({ label, value, items, onChange }: PickerProps) {
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <FieldItem>
        <SelectLabel>{label}</SelectLabel>
        <SelectTrigger>
          <SelectValue />
          <span aria-hidden="true">▾</span>
        </SelectTrigger>
      </FieldItem>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
            <SelectCheck />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
