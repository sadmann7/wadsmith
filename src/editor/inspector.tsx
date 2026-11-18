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
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import type { ReactNode } from "react";

import {
  ceilingTextures,
  doorTextures,
  floorTextures,
  sectorEffects,
  switchTextures,
  thingCatalog,
  wallTextures,
} from "../map/catalog";
import { defaultDoor } from "../map/edit";
import {
  canRepeatChoice,
  describeLine,
  fitLineAction,
  isLineActionKind,
  keysFor,
  lineActionKinds,
  lineActions,
  lineUsesTag,
  newLineAction,
  triggerLabels,
  triggersFor,
} from "../map/lines";
import { describeSurface, surfaceKey, type WallPart } from "../map/surfaces";
import type {
  DoorSettings,
  GameMap,
  KeyColor,
  LineSettings,
  LineSide,
  LineTrigger,
  MapSwitch,
  Sector,
  SectorEffect,
  Thing,
} from "../map/types";
import { TextureSwatch } from "../preview/surface-panel";
import type { SceneAssets } from "../wad/assets";

const offsetLimit = 32767;
const tagLimit = 32767;
const keyLabels: Record<KeyColor, string> = {
  blue: "Blue key",
  yellow: "Yellow key",
  red: "Red key",
};
const partLabels: Record<WallPart, string> = {
  upper: "Upper",
  middle: "Wall",
  lower: "Lower",
};
const lineFlags: { flag: keyof LineSettings; label: string }[] = [
  { flag: "blocksEnemies", label: "Blocks enemies" },
  { flag: "upperFixed", label: "Keep upper texture fixed" },
  { flag: "lowerFixed", label: "Keep lower texture fixed" },
  { flag: "hidden", label: "Hide on automap" },
];

function InspectorSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      <h2>
        {title}
        {detail ? <span>{detail}</span> : null}
      </h2>
      <div className="stack">{children}</div>
    </section>
  );
}

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

function SwatchField({
  name,
  picture,
  assets,
  children,
}: {
  name: string;
  picture: SceneAssets["flat"];
  assets: SceneAssets;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-end gap-2.5">
      <TextureSwatch name={name} picture={picture(name)} assets={assets} />
      {children}
    </div>
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
  assets,
  onChange,
}: {
  sector: Sector;
  assets: SceneAssets;
  onChange: (patch: Partial<Sector>) => void;
}) {
  const { door } = sector;
  return (
    <>
      <InspectorSection title={door ? "Door" : "Room"}>
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
          <DoorFields
            door={door}
            onChange={(next) => onChange({ door: next })}
          />
        ) : null}
      </InspectorSection>
      <InspectorSection
        title="Height"
        detail={door ? undefined : String(sector.ceiling - sector.floor)}
      >
        <div className="row">
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
          <NumberField
            label="Floor"
            value={sector.floor}
            step={8}
            min={-1024}
            max={1024}
            onChange={(floor) => onChange({ floor })}
          />
        </div>
      </InspectorSection>
      <InspectorSection title="Surfaces">
        <SwatchField
          name={sector.floorTexture}
          picture={assets.flat}
          assets={assets}
        >
          <TextureField
            label="Floor"
            value={sector.floorTexture}
            options={floorTextures}
            onChange={(floorTexture) => onChange({ floorTexture })}
          />
        </SwatchField>
        <SwatchField
          name={sector.ceilingTexture}
          picture={assets.flat}
          assets={assets}
        >
          <TextureField
            label="Ceiling"
            value={sector.ceilingTexture}
            options={ceilingTextures}
            onChange={(ceilingTexture) => onChange({ ceilingTexture })}
          />
        </SwatchField>
        <SwatchField
          name={sector.wallTexture}
          picture={assets.texture}
          assets={assets}
        >
          <TextureField
            label="Walls"
            value={sector.wallTexture}
            options={wallTextures}
            onChange={(wallTexture) =>
              onChange({ wallTexture, wallOverrides: undefined })
            }
          />
        </SwatchField>
      </InspectorSection>
      <InspectorSection title="Behaviour">
        <Slider
          className="slider"
          value={sector.light}
          min={0}
          max={255}
          step={1}
          onValueChange={(light) => onChange({ light: light as number })}
        >
          <div className="slider-head">
            <span className="label">Light level</span>
            <SliderValue />
          </div>
          <SliderControl className="slider-control">
            <SliderTrack className="slider-track">
              <SliderIndicator className="slider-indicator" />
              <SliderThumb className="slider-thumb" aria-label="Light level" />
            </SliderTrack>
          </SliderControl>
        </Slider>
        <div className="row items-end">
          <ChoiceField
            label="Effect"
            value={sector.effect ?? "none"}
            items={[
              { value: "none", label: "None" },
              ...Object.entries(sectorEffects).map(([value, { label }]) => ({
                value,
                label,
              })),
            ]}
            onChange={(effect) =>
              onChange({
                effect:
                  effect === "none" ? undefined : (effect as SectorEffect),
              })
            }
          />
          <NumberField
            label="Tag"
            value={sector.tag ?? 0}
            step={1}
            min={0}
            max={tagLimit}
            onChange={(tag) => onChange({ tag: tag || undefined })}
          />
        </div>
      </InspectorSection>
    </>
  );
}

function LineInspector({
  map,
  wall,
  sector,
  assets,
  onSelectSide,
  onPaint,
  onLineChange,
  onSideChange,
  onTargetChange,
}: {
  map: GameMap;
  wall: string;
  sector: string;
  assets: SceneAssets;
  onSelectSide: (sector: string) => void;
  onPaint: (part: WallPart, texture: string, wholeRoom?: boolean) => void;
  onLineChange: (patch: Omit<LineSettings, "sides">) => void;
  onSideChange: (patch: LineSide) => void;
  onTargetChange: (sector: string | null) => void;
}) {
  const line = describeLine(map, wall, sector);
  const { settings, twoSided, front, back } = line;
  const side = settings.sides?.[line.sector.id];
  const { action } = settings;
  const parts: WallPart[] = twoSided ? ["upper", "lower"] : ["middle"];
  const fields = parts.flatMap((part) => {
    const info = describeSurface(
      map,
      surfaceKey({ kind: "wall", sector: line.sector.id, wall, part }),
    );
    return info?.paints && info.texture ? [{ part, info }] : [];
  });
  const opensDoor = back?.door?.opensBy === "use";
  const target = action?.tag
    ? map.sectors.find((item) => item.tag === action.tag)
    : undefined;
  const changeAction = (patch: Partial<NonNullable<typeof action>>) => {
    if (action) {
      onLineChange({
        action: fitLineAction({ ...action, ...patch }, twoSided),
      });
    }
  };

  return (
    <>
      <InspectorSection title="Wall textures">
        {back ? (
          <SegmentedControl
            aria-label="Line side"
            className="segments self-start"
            value={line.isBack ? back.id : front.id}
            onValueChange={(next) => onSelectSide(next as string)}
          >
            <SegmentedControlIndicator className="segments-indicator" />
            <SegmentedControlItem value={front.id}>
              Front side
            </SegmentedControlItem>
            <SegmentedControlItem value={back.id}>
              Back side
            </SegmentedControlItem>
          </SegmentedControl>
        ) : null}
        {fields.map(({ part, info }) => (
          <SwatchField
            key={part}
            name={info.texture!}
            picture={assets.texture}
            assets={assets}
          >
            <TextureField
              label={
                info.paints === "door"
                  ? "Door"
                  : info.paints === "switch"
                    ? "Switch"
                    : partLabels[part]
              }
              value={info.texture!}
              options={info.textures}
              onChange={(texture) => onPaint(part, texture)}
            />
          </SwatchField>
        ))}
        <div className="row">
          <NumberField
            label="Offset X"
            value={side?.offsetX ?? 0}
            step={1}
            min={-offsetLimit}
            max={offsetLimit}
            onChange={(offsetX) =>
              onSideChange({ offsetX: offsetX || undefined })
            }
          />
          <NumberField
            label="Offset Y"
            value={side?.offsetY ?? 0}
            step={1}
            min={-offsetLimit}
            max={offsetLimit}
            onChange={(offsetY) =>
              onSideChange({ offsetY: offsetY || undefined })
            }
          />
        </div>
        {fields.some(({ info }) => info.paints === "wall") ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              const field = fields.find(({ info }) => info.paints === "wall")!;
              onPaint(field.part, field.info.texture!, true);
            }}
          >
            Use on every wall in this room
          </button>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Action">
        {line.wiredSwitch ? (
          <p className="muted">The switch on this line opens its door.</p>
        ) : (
          <>
            <ChoiceField
              label="When triggered"
              value={action?.kind ?? "none"}
              items={[
                {
                  value: "none",
                  label: opensDoor ? "From door settings" : "Nothing",
                },
                ...lineActionKinds.map((value) => ({
                  value,
                  label: lineActions[value].label,
                })),
              ]}
              onChange={(kind) => {
                if (!isLineActionKind(kind)) {
                  onLineChange({ action: undefined });
                } else if (action) {
                  changeAction({ kind });
                } else {
                  onLineChange({ action: newLineAction(twoSided, kind) });
                }
              }}
            />
            {action ? (
              <>
                <div className="row items-end">
                  <ChoiceField
                    label="Trigger"
                    value={action.trigger}
                    items={triggersFor(action.kind, twoSided).map((value) => ({
                      value,
                      label: triggerLabels[value],
                    }))}
                    onChange={(trigger) =>
                      changeAction({ trigger: trigger as LineTrigger })
                    }
                  />
                  {keysFor(action.kind, action.trigger).length > 0 ? (
                    <ChoiceField
                      label="Needs key"
                      value={action.key ?? "none"}
                      items={[
                        { value: "none", label: "None" },
                        ...keysFor(action.kind, action.trigger).map(
                          (value) => ({ value, label: keyLabels[value] }),
                        ),
                      ]}
                      onChange={(key) =>
                        changeAction({
                          key: key === "none" ? undefined : (key as KeyColor),
                        })
                      }
                    />
                  ) : null}
                </div>
                {lineUsesTag(action) ? (
                  <ChoiceField
                    label="Moves sector"
                    value={target?.id ?? "none"}
                    items={[
                      { value: "none", label: "Choose a sector" },
                      ...map.sectors.map((item) => ({
                        value: item.id,
                        label: item.name,
                      })),
                    ]}
                    onChange={(next) =>
                      onTargetChange(next === "none" ? null : next)
                    }
                  />
                ) : null}
                {canRepeatChoice(action) ? (
                  <ToggleField
                    label="Can repeat"
                    checked={action.repeat}
                    onChange={(repeat) => changeAction({ repeat })}
                  />
                ) : null}
                {twoSided &&
                (action.trigger === "door" || action.trigger === "switch") ? (
                  <p className="muted">Press it from the front side.</p>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </InspectorSection>
      <InspectorSection title="Flags">
        {twoSided ? (
          <ToggleField
            label="Blocks players and enemies"
            checked={Boolean(settings.blocksAll)}
            onChange={(checked) =>
              onLineChange({ blocksAll: checked || undefined })
            }
          />
        ) : null}
        {lineFlags.map(({ flag, label }) => (
          <ToggleField
            key={flag}
            label={label}
            checked={Boolean(settings[flag])}
            onChange={(checked) =>
              onLineChange({ [flag]: checked || undefined })
            }
          />
        ))}
      </InspectorSection>
    </>
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

export { LineInspector, SectorInspector, SwitchInspector, ThingInspector };
