import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { mostSegments } from "@/lib/map/wall-tools";

interface CurveDialogProps {
  walls: number;
  onApply: (segments: number, distance: number) => void;
  onClose: () => void;
}

export function CurveDialog({ walls, onApply, onClose }: CurveDialogProps) {
  const [segments, setSegments] = React.useState(8);
  const [distance, setDistance] = React.useState(64);
  return (
    <ToolDialog
      title={walls === 1 ? "Curve the wall" : `Curve ${walls} walls`}
      onApply={() => onApply(segments, distance)}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Amount
          label="Segments"
          value={segments}
          step={1}
          min={2}
          max={mostSegments}
          onChange={setSegments}
        />
        <Amount
          label="Bulge"
          value={distance}
          step={8}
          min={-1024}
          max={1024}
          onChange={setDistance}
        />
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        A wall bulges away from the room in front of it, or into it with a
        negative bulge.
      </p>
    </ToolDialog>
  );
}

interface StairsDialogProps {
  // How many rooms are stepped. One room is cut into steps first.
  rooms: number;
  onApply: (steps: number, height: number, ceilings: boolean) => void;
  onClose: () => void;
}

export function StairsDialog({ rooms, onApply, onClose }: StairsDialogProps) {
  const [steps, setSteps] = React.useState(4);
  const [height, setHeight] = React.useState(16);
  const [ceilings, setCeilings] = React.useState(true);
  const cutting = rooms === 1;
  return (
    <ToolDialog
      title="Build stairs"
      onApply={() => onApply(steps, height, ceilings)}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        {cutting ? (
          <Amount
            label="Steps"
            value={steps}
            step={1}
            min={2}
            max={64}
            onChange={setSteps}
          />
        ) : null}
        <Amount
          label="Each step rises"
          value={height}
          step={4}
          min={-128}
          max={128}
          onChange={setHeight}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={ceilings}
          onCheckedChange={(checked) => setCeilings(checked === true)}
        />
        Move the ceilings with the floors
      </label>
      <p className="m-0 text-sm text-muted-foreground">
        {cutting
          ? "The room is cut across its longer side, and the steps climb from its left or top end."
          : `The ${rooms} rooms climb in the order they join, from the room at one end of the run.`}
      </p>
    </ToolDialog>
  );
}

interface ToolDialogProps {
  title: string;
  children: React.ReactNode;
  onApply: () => void;
  onClose: () => void;
}

function ToolDialog({ title, children, onApply, onClose }: ToolDialogProps) {
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
          <DialogTitle>{title}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            onApply();
            onClose();
          }}
        >
          <div className="grid gap-4 p-5">{children}</div>
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

interface AmountProps {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function Amount({ label, value, step, min, max, onChange }: AmountProps) {
  return (
    <FieldItem>
      <Label>{label}</Label>
      <NumberField
        label={label}
        value={value}
        step={step}
        min={min}
        max={max}
        onValueChange={(next) => {
          if (next !== null) onChange(Math.round(next));
        }}
      />
    </FieldItem>
  );
}
