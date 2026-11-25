import * as React from "react";

import type { Transform } from "@/lib/map/fragment";

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
import { FieldItem, Label } from "@/components/ui/field";
import { NumberField } from "@/components/ui/number-field";
import { stepWay } from "@/lib/editor/step-way";

const percentStep = 10;
const percentMin = 10;
const percentMax = 1000;

interface TransformDialogProps {
  onApply: (steps: Transform[]) => void;
  onClose: () => void;
}

export function TransformDialog({ onApply, onClose }: TransformDialogProps) {
  const [degrees, setDegrees] = React.useState(0);
  const [percent, setPercent] = React.useState(100);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[360px]">
        <DialogHeader>
          <DialogTitle>Turn or resize</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            onApply([
              ...(degrees % 360 === 0
                ? []
                : [{ kind: "rotate" as const, degrees }]),
              ...(percent === 100
                ? []
                : [{ kind: "scale" as const, factor: percent / 100 }]),
            ]);
            onClose();
          }}
        >
          <div className="grid gap-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <FieldItem>
                <Label>Turn right, in degrees</Label>
                <NumberField
                  label="Turn right, in degrees"
                  value={degrees}
                  step={15}
                  min={-360}
                  max={360}
                  onValueChange={(next) => {
                    if (next !== null) setDegrees(Math.round(next));
                  }}
                />
              </FieldItem>
              <FieldItem>
                <Label>Size, in percent</Label>
                <NumberField
                  label="Size, in percent"
                  value={percent}
                  min={percentMin}
                  max={percentMax}
                  step={1}
                  largeStep={1}
                  smallStep={1}
                  onValueChange={(next, details) => {
                    if (next === null) return;
                    const way = stepWay(details);
                    const fine =
                      details.event instanceof MouseEvent ||
                      details.event instanceof KeyboardEvent
                        ? details.event.shiftKey
                        : false;
                    // The field steps by 1 so typed sizes never snap; a plain
                    // step moves by 10 instead.
                    const size =
                      way && !fine
                        ? clampPercent(next - way) + way * percentStep
                        : next;
                    setPercent(clampPercent(Math.round(size)));
                  }}
                />
              </FieldItem>
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              The selection turns and grows about its middle, and its corners
              land on the grid.
            </p>
          </div>
          <DialogFooter className="justify-end">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit">
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function clampPercent(percent: number) {
  return Math.min(percentMax, Math.max(percentMin, percent));
}
