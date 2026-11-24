import { FieldItem, Label } from "@/components/ui/field";
import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import { stepWay } from "@/lib/editor/step-way";

const lightStep = 16;
const lightMax = 255;

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
          largeStep={lightStep}
          onValueChange={(light) => onChange(light as number)}
          onClick={(event) =>
            event.currentTarget
              .querySelector<HTMLInputElement>('input[type="range"]')
              ?.focus()
          }
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
            const way = stepWay(details);
            const fine =
              details.event instanceof MouseEvent ||
              details.event instanceof KeyboardEvent
                ? details.event.shiftKey
                : false;
            // The field steps by 1 so typed levels never snap; a plain step
            // moves by Doom's light steps of 16 instead.
            const light =
              way && !fine ? clamp(next - way) + way * lightStep : next;
            onChange(clamp(Math.round(light)));
          }}
        />
      </div>
    </FieldItem>
  );
}

function clamp(light: number) {
  return Math.min(lightMax, Math.max(0, light));
}
