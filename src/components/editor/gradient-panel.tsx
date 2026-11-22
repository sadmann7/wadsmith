import * as React from "react";

import { Button } from "@/components/ui/button";
import { FieldItem, Label } from "@/components/ui/field";
import { NumberField } from "@/components/ui/number-field";

interface GradientPanelProps {
  count: number;
  // The first and last picked surfaces' heights and brightness, to start from.
  heights: [number, number] | null;
  lights: [number, number];
  onApply: (what: "height" | "light", from: number, to: number) => void;
}

export function GradientPanel({
  count,
  heights,
  lights,
  onApply,
}: GradientPanelProps) {
  return (
    <section className="inspector-section" aria-label="Picked surfaces">
      <h2>{count} surfaces</h2>
      <p className="m-0 text-sm text-muted-foreground">
        A gradient runs from the first surface picked to the last, in even
        steps.
      </p>
      {heights ? (
        <GradientRow
          label="Height"
          step={8}
          min={-2048}
          max={2048}
          start={heights}
          onApply={(from, to) => onApply("height", from, to)}
        />
      ) : null}
      <GradientRow
        label="Brightness"
        step={16}
        min={0}
        max={255}
        start={lights}
        onApply={(from, to) => onApply("light", from, to)}
      />
    </section>
  );
}

interface GradientRowProps {
  label: string;
  step: number;
  min: number;
  max: number;
  start: [number, number];
  onApply: (from: number, to: number) => void;
}

function GradientRow({
  label,
  step,
  min,
  max,
  start,
  onApply,
}: GradientRowProps) {
  const [from, setFrom] = React.useState(start[0]);
  const [to, setTo] = React.useState(start[1]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
      <FieldItem>
        <Label>{label} from</Label>
        <NumberField
          label={`${label} from`}
          value={from}
          step={step}
          min={min}
          max={max}
          onValueChange={(next) => {
            if (next !== null) setFrom(Math.round(next));
          }}
        />
      </FieldItem>
      <FieldItem>
        <Label>to</Label>
        <NumberField
          label={`${label} to`}
          value={to}
          step={step}
          min={min}
          max={max}
          onValueChange={(next) => {
            if (next !== null) setTo(Math.round(next));
          }}
        />
      </FieldItem>
      <Button onClick={() => onApply(from, to)}>Apply</Button>
    </div>
  );
}
