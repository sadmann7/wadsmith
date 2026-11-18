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

import {
  ceilingTextures,
  floorTextures,
  thingCatalog,
  wallTextures,
} from "../map/catalog";
import type { Sector, Thing } from "../map/types";

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
          if (next !== null) onChange(next);
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

function SectorInspector({
  sector,
  onChange,
}: {
  sector: Sector;
  onChange: (patch: Partial<Sector>) => void;
}) {
  return (
    <div className="stack">
      <label className="field">
        <span className="label">Name</span>
        <Input
          className="text-input"
          value={sector.name}
          onValueChange={(name) => onChange({ name })}
        />
      </label>
      <div className="row">
        <NumberField
          label="Floor"
          value={sector.floor}
          step={8}
          min={-1024}
          max={1024}
          onChange={(floor) => onChange({ floor })}
        />
        <NumberField
          label="Ceiling"
          value={sector.ceiling}
          step={8}
          min={-1024}
          max={2048}
          onChange={(ceiling) => onChange({ ceiling })}
        />
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
        onChange={(wallTexture) => onChange({ wallTexture })}
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

export { SectorInspector, ThingInspector };
