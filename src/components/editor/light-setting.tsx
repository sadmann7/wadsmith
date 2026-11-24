import type { NumberInputValueChangeReason } from "@ui-sdk/react/number-input";

import { FieldItem, Label } from "@/components/ui/field";
import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";

const lightStep = 16;
const lightMax = 255;

const stepReasons: NumberInputValueChangeReason[] = [
  "increment-press",
  "decrement-press",
  "step-key",
  "wheel",
];

interface LightSettingProps {
  value: number;
  onChange: (light: number) => void;
}

export function LightSetting({ value, onChange }: LightSettingProps) {
  return (
    <FieldItem>
      <Label>Light level</Label>
      <div className="flex items-center gap-3">
        <Slider
          label="Light level"
          className="min-w-0 flex-1"
          value={value}
          min={0}
          max={lightMax}
          step={1}
          onValueChange={(light) => onChange(light as number)}
        />
        <NumberField
          label="Light level"
          className="w-[104px]"
          value={value}
          min={0}
          max={lightMax}
          step={1}
          largeStep={1}
          smallStep={1}
          onValueChange={(next, details) => {
            if (next === null) return;
            const event = details.event;
            const key = event instanceof KeyboardEvent ? event.key : "";
            const fine =
              event instanceof MouseEvent || event instanceof KeyboardEvent
                ? event.shiftKey
                : false;
            // The field steps by 1 so typed levels never snap; a plain step
            // moves by Doom's light steps of 16 instead.
            const coarse =
              stepReasons.includes(details.reason) &&
              key !== "Home" &&
              key !== "End" &&
              !fine;
            const light = coarse
              ? value + Math.sign(next - value) * lightStep
              : next;
            onChange(Math.min(lightMax, Math.max(0, Math.round(light))));
          }}
        />
      </div>
    </FieldItem>
  );
}
