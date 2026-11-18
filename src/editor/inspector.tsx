import { Input } from "@ui-sdk/react/input";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";

import {
  ceilingTextures,
  doorTextures,
  floorTextures,
  switchTextures,
  thingCatalog,
  wallTextures,
} from "../map/catalog";
import { defaultDoor } from "../map/edit";
import type { DoorSettings, MapSwitch, Sector, Thing } from "../map/types";

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <NumberInput
        value={value}
        step={step}
        min={min}
        max={max}
        onValueChange={(next) => {
          if (next !== null) onChange(Math.round(next));
        }}
      >
        <NumberInputGroup className="number">
          <NumberInputDecrement aria-label={`Lower ${label}`}>
            −
          </NumberInputDecrement>
          <NumberInputControl aria-label={label} />
          <NumberInputIncrement aria-label={`Raise ${label}`}>
            +
          </NumberInputIncrement>
        </NumberInputGroup>
      </NumberInput>
    </div>
  );
}

function TextureField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={[...options]}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <div className="field">
        <SelectLabel className="label">{label}</SelectLabel>
        <SelectTrigger className="select-trigger">
          <SelectValue />
          <span aria-hidden="true">▾</span>
        </SelectTrigger>
      </div>
      <SelectContent className="select-content">
        {options.map((option) => (
          <SelectItem key={option} value={option} className="select-item">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChoiceField({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <div className="field">
        <SelectLabel className="label">{label}</SelectLabel>
        <SelectTrigger className="select-trigger">
          <SelectValue />
          <span aria-hidden="true">▾</span>
        </SelectTrigger>
      </div>
      <SelectContent className="select-content">
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="select-item"
          >
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <Switch className="switch" checked={checked} onCheckedChange={onChange}>
        <SwitchThumb className="switch-thumb" />
      </Switch>
    </label>
  );
}

function DoorFields({
  door,
  onChange,
}: {
  door: DoorSettings;
  onChange: (door: DoorSettings) => void;
}) {
  return (
    <>
      <ChoiceField
        label="Opens with"
        value={door.opensBy}
        items={[
          { value: "use", label: "Use key" },
          { value: "switch", label: "Switch" },
        ]}
        onChange={(opensBy) =>
          onChange({ ...door, opensBy: opensBy as DoorSettings["opensBy"] })
        }
      />
      <ToggleField
        label="Closes again"
        checked={door.closes}
        onChange={(closes) => onChange({ ...door, closes })}
      />
      <TextureField
        label="Door texture"
        value={door.texture}
        options={doorTextures}
        onChange={(texture) => onChange({ ...door, texture })}
      />
    </>
  );
}

function SectorInspector({
  sector,
  onChange,
}: {
  sector: Sector;
  onChange: (patch: Partial<Sector>) => void;
}) {
  const { door } = sector;
  return (
    <div className="stack">
      <label className="field">
        <span className="label">Name</span>
        <Input
          className="text-input"
          maxLength={80}
          value={sector.name}
          onValueChange={(name) => onChange({ name })}
        />
      </label>
      <ToggleField
        label="Door"
        checked={Boolean(door)}
        onChange={(checked) =>
          onChange({ door: checked ? defaultDoor : undefined })
        }
      />
      {door ? (
        <DoorFields door={door} onChange={(next) => onChange({ door: next })} />
      ) : null}
      <div className="row">
        <NumberField
          label="Floor"
          value={sector.floor}
          step={8}
          min={-1024}
          max={1024}
          onChange={(floor) => onChange({ floor })}
        />
        {door ? null : (
          <NumberField
            label="Ceiling"
            value={sector.ceiling}
            step={8}
            min={-1024}
            max={2048}
            onChange={(ceiling) => onChange({ ceiling })}
          />
        )}
      </div>
      <Slider
        className="slider"
        value={sector.light}
        min={0}
        max={255}
        step={1}
        onValueChange={(light) => onChange({ light: light as number })}
      >
        <div className="slider-head">
          <span className="label">Light</span>
          <SliderValue />
        </div>
        <SliderControl className="slider-control">
          <SliderTrack className="slider-track">
            <SliderIndicator className="slider-indicator" />
            <SliderThumb className="slider-thumb" aria-label="Light" />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <TextureField
        label="Walls"
        value={sector.wallTexture}
        options={wallTextures}
        onChange={(wallTexture) =>
          onChange({ wallTexture, wallOverrides: undefined })
        }
      />
      <TextureField
        label="Floor texture"
        value={sector.floorTexture}
        options={floorTextures}
        onChange={(floorTexture) => onChange({ floorTexture })}
      />
      <TextureField
        label="Ceiling texture"
        value={sector.ceilingTexture}
        options={ceilingTextures}
        onChange={(ceilingTexture) => onChange({ ceilingTexture })}
      />
    </div>
  );
}

function ThingInspector({
  thing,
  onChange,
}: {
  thing: Thing;
  onChange: (patch: Partial<Thing>) => void;
}) {
  return (
    <div className="stack">
      <p className="thing-name">{thingCatalog[thing.kind].label}</p>
      <NumberField
        label="Facing"
        value={thing.angle}
        step={45}
        min={0}
        max={315}
        onChange={(angle) => onChange({ angle })}
      />
    </div>
  );
}

function SwitchInspector({
  item,
  doors,
  onChange,
}: {
  item: MapSwitch;
  doors: Sector[];
  onChange: (patch: Partial<MapSwitch>) => void;
}) {
  return (
    <div className="stack">
      <ChoiceField
        label="Opens"
        value={item.door ?? "none"}
        items={[
          { value: "none", label: "Nothing" },
          ...doors.map((door) => ({ value: door.id, label: door.name })),
        ]}
        onChange={(door) => onChange({ door: door === "none" ? null : door })}
      />
      <TextureField
        label="Switch texture"
        value={item.texture}
        options={switchTextures}
        onChange={(texture) => onChange({ texture })}
      />
    </div>
  );
}

export { SectorInspector, SwitchInspector, ThingInspector };
