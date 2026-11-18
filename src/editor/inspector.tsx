import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
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
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { Check, Search, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  ceilingTextures,
  doorTextures,
  floorTextures,
  sectorEffects,
  switchTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
} from "../map/catalog";
import { appearsOn, mapBalance } from "../map/balance";
import { defaultDoor, gridSize } from "../map/edit";
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
  ThingKind,
  ThingSkill,
} from "../map/types";
import { flatUse, wallUse, type TextureUse } from "../map/textures";
import { TextureSwatch } from "../preview/surface-panel";
import type { SceneAssets } from "../wad/assets";
import { TexturePicker, type TextureKind } from "./texture-picker";
import { thingIcons } from "./thing-icons";

type ThingTab = "enemy" | "item" | "key" | "decor";

const thingTabs: { value: ThingTab; label: string }[] = [
  { value: "enemy", label: "Enemies" },
  { value: "item", label: "Items" },
  { value: "key", label: "Keys" },
  { value: "decor", label: "Decor" },
];
const allSkills: ThingSkill[] = ["easy", "medium", "hard"];
const skillLabels: Record<ThingSkill, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};
// Playtests launch the engine on skill 3.
const playtestSkill: ThingSkill = "medium";
const coordinateLimit = 32000;
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

function tabOf(kind: ThingKind): ThingTab {
  const { category } = thingCatalog[kind];
  return category === "start" ? "item" : category;
}

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
  picture,
  assets,
  light,
  whole,
  browse,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  picture: SceneAssets["texture"];
  assets: SceneAssets;
  light: number;
  whole?: boolean;
  browse?: { kind: TextureKind; use: TextureUse; context: string };
  onChange: (value: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const items = options.includes(value) ? options : [value, ...options];
  const swatch = (
    <TextureSwatch
      name={value}
      picture={picture(value)}
      assets={assets}
      light={light}
      whole={whole}
    />
  );
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-end gap-2.5">
      {browse ? (
        <button
          type="button"
          aria-label={`Browse ${label.toLowerCase()} textures`}
          title="Browse textures"
          className="size-12 cursor-pointer rounded-[3px] border-0 bg-transparent p-0 outline-offset-1 hover:outline-2 hover:outline-ember"
          onClick={() => setBrowsing(true)}
        >
          {swatch}
        </button>
      ) : (
        swatch
      )}
      <Select
        value={value}
        items={[...items]}
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
          {items.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className="select-item flex items-center gap-2"
            >
              <TextureSwatch
                name={option}
                picture={picture(option)}
                assets={assets}
                light={light}
                whole={whole}
                className="size-8 shrink-0 rounded-xs [image-rendering:pixelated]"
              />
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {browse && browsing ? (
        <TexturePicker
          kind={browse.kind}
          title={`Choose ${label.toLowerCase()} texture`}
          context={browse.context}
          value={value}
          common={options}
          use={browse.use}
          picture={picture}
          assets={assets}
          light={light}
          onApply={onChange}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </div>
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
  assets,
  light,
  onChange,
}: {
  door: DoorSettings;
  assets: SceneAssets;
  light: number;
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
        picture={assets.texture}
        assets={assets}
        light={light}
        whole
        onChange={(texture) => onChange({ ...door, texture })}
      />
    </>
  );
}

function SectorInspector({
  map,
  sector,
  assets,
  onChange,
}: {
  map: GameMap;
  sector: Sector;
  assets: SceneAssets;
  onChange: (patch: Partial<Sector>) => void;
}) {
  const { door } = sector;
  const flats = {
    kind: "flat" as const,
    use: flatUse(map),
    context: sector.name,
  };
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
            assets={assets}
            light={sector.light}
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
        <TextureField
          picture={assets.flat}
          assets={assets}
          label="Floor"
          value={sector.floorTexture}
          options={floorTextures}
          browse={flats}
          light={sector.light}
          onChange={(floorTexture) => onChange({ floorTexture })}
        />
        <TextureField
          picture={assets.flat}
          assets={assets}
          label="Ceiling"
          value={sector.ceilingTexture}
          options={ceilingTextures}
          browse={flats}
          light={sector.light}
          onChange={(ceilingTexture) => onChange({ ceilingTexture })}
        />
        <TextureField
          picture={assets.texture}
          assets={assets}
          label="Walls"
          value={sector.wallTexture}
          options={wallTextures}
          browse={{ kind: "wall", use: wallUse(map), context: sector.name }}
          light={sector.light}
          onChange={(wallTexture) =>
            onChange({ wallTexture, wallOverrides: undefined })
          }
        />
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
          <TextureField
            key={part}
            picture={assets.texture}
            assets={assets}
            light={line.sector.light}
            whole={info.paints === "door" || info.paints === "switch"}
            browse={
              info.paints === "wall"
                ? {
                    kind: "wall",
                    use: wallUse(map),
                    context: `Line ${line.number}, ${line.sector.name}`,
                  }
                : undefined
            }
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

function CompactNumber({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field min-w-0 flex-1">
      <span className="label">{label}</span>
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          if (next !== null) onChange(Math.round(next));
        }}
      >
        <NumberInputGroup className="flex h-8 items-center rounded-[2px] border border-line bg-bg px-2">
          <NumberInputControl
            aria-label={label}
            className="w-full min-w-0 border-0 bg-transparent font-mono text-xs tabular-nums outline-none"
          />
          {suffix ? (
            <span className="font-mono text-xs text-muted">{suffix}</span>
          ) : null}
        </NumberInputGroup>
      </NumberInput>
    </div>
  );
}

function Meter({
  label,
  value,
  fill,
  color,
}: {
  label: string;
  value: number;
  fill: number;
  color: string;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-xs">{value}</span>
      </div>
      <div className="h-1 bg-raised">
        <div
          className="h-full"
          style={{ width: `${Math.min(1, fill) * 100}%`, background: color }}
        />
      </div>
    </div>
  );
}

function BalancePanel({ map }: { map: GameMap }) {
  const balance = mapBalance(map, playtestSkill);
  const { enemies, health, ammo, keys, keysNeeded, healthShort, ammoShort } =
    balance;
  const advice = [
    ammoShort > 0 ? `about ${ammoShort} more ammo` : null,
    healthShort > 0 ? `about ${healthShort} more health` : null,
    keysNeeded > 0
      ? `${keysNeeded} missing ${keysNeeded === 1 ? "key" : "keys"}`
      : null,
  ].filter(Boolean);
  return (
    <InspectorSection title="Balance" detail={skillLabels[playtestSkill]}>
      <Meter
        label="Enemies"
        value={enemies}
        fill={enemies > 0 ? 1 : 0}
        color="var(--danger)"
      />
      <Meter
        label="Health pickups"
        value={health}
        fill={health / (health + healthShort || 1)}
        color="var(--cold)"
      />
      <Meter
        label="Ammo pickups"
        value={ammo}
        fill={ammo / (ammo + ammoShort || 1)}
        color="var(--acid)"
      />
      <Meter
        label="Keys"
        value={keys}
        fill={keys / (keys + keysNeeded || 1)}
        color="var(--key)"
      />
      {advice.length > 0 ? (
        <p className="flex gap-2">
          <TriangleAlert
            size={14}
            className="mt-0.5 shrink-0 text-key"
            aria-hidden="true"
          />
          Add {advice.join(", ")}.
        </p>
      ) : null}
    </InspectorSection>
  );
}

function PlaceThings({
  kind,
  onPick,
}: {
  kind: ThingKind;
  onPick: (kind: ThingKind) => void;
}) {
  const [tab, setTab] = useState(() => tabOf(kind));
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const shown = thingKinds.filter((item) =>
    search
      ? thingCatalog[item].label.toLowerCase().includes(search)
      : tabOf(item) === tab,
  );
  return (
    <InspectorSection title="Place a thing">
      <label className="flex h-8 items-center gap-2 rounded-[2px] border border-line bg-bg px-2">
        <Search size={14} className="text-muted" aria-hidden="true" />
        <Input
          aria-label="Search things"
          placeholder="Search things"
          className="w-full min-w-0 border-0 bg-transparent outline-none"
          value={query}
          onValueChange={setQuery}
        />
      </label>
      <SegmentedControl
        aria-label="Thing type"
        className="segments w-full [&>button]:flex-1 [&>button]:px-1"
        value={tab}
        onValueChange={(next) => setTab(next as ThingTab)}
      >
        <SegmentedControlIndicator className="segments-indicator" />
        {thingTabs.map(({ value, label }) => (
          <SegmentedControlItem key={value} value={value}>
            {label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {shown.length > 0 ? (
        <div className="grid grid-cols-4 gap-1.5">
          {shown.map((item) => {
            const { icon: Icon, color } = thingIcons[item];
            const active = item === kind;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                title={thingCatalog[item].label}
                className="grid h-[58px] min-w-0 content-center justify-items-center gap-1 rounded-[2px] border-0 bg-raised px-1 text-xs text-muted hover:text-text aria-pressed:bg-ember/15 aria-pressed:text-text"
                onClick={() => onPick(item)}
              >
                <Icon
                  size={18}
                  style={{ color: active ? "var(--accent)" : color }}
                  aria-hidden="true"
                />
                <span className="w-full truncate text-center">
                  {thingCatalog[item].label}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">No things match.</p>
      )}
    </InspectorSection>
  );
}

type ThingChange = (thing: Thing) => Partial<Omit<Thing, "id">>;

function ThingFields({
  things,
  onChange,
}: {
  things: Thing[];
  onChange: (change: ThingChange) => void;
}) {
  const [first] = things;
  const single = things.length === 1 ? first : null;
  const placed = things.filter((thing) => thing.kind !== "player");
  const enemies = things.filter(
    (thing) => thingCatalog[thing.kind].category === "enemy",
  );
  const pressed = allSkills.filter((skill) =>
    placed.every((thing) => appearsOn(thing.skills, skill)),
  );
  const toggleSkill = (skill: ThingSkill, on: boolean) =>
    onChange((thing) => {
      if (thing.kind === "player") return {};
      const next = allSkills.filter((item) =>
        item === skill ? on : appearsOn(thing.skills, item),
      );
      if (next.length === 0) return {};
      return {
        skills: next.length === allSkills.length ? undefined : next,
      };
    });
  return (
    <>
      <InspectorSection title="Placement">
        <div className="flex gap-2.5">
          {single ? (
            <>
              <CompactNumber
                label="X"
                value={single.x}
                min={-coordinateLimit}
                max={coordinateLimit}
                step={gridSize}
                onChange={(x) => onChange(() => ({ x }))}
              />
              <CompactNumber
                label="Y"
                value={0 - single.y}
                min={-coordinateLimit}
                max={coordinateLimit}
                step={gridSize}
                onChange={(y) => onChange(() => ({ y: 0 - y }))}
              />
            </>
          ) : null}
          <CompactNumber
            label="Facing"
            value={first.angle}
            min={0}
            max={359}
            step={45}
            suffix="°"
            onChange={(angle) => onChange(() => ({ angle }))}
          />
        </div>
      </InspectorSection>
      {placed.length > 0 ? (
        <InspectorSection title="Appears on">
          <ToggleGroup
            aria-label="Difficulties"
            multiple
            className="grid grid-cols-3 gap-0.5 rounded-[3px] bg-bg p-0.5"
            value={pressed}
            onValueChange={(next) => {
              const changed = allSkills.find(
                (skill) => next.includes(skill) !== pressed.includes(skill),
              );
              if (changed) toggleSkill(changed, next.includes(changed));
            }}
          >
            {allSkills.map((skill) => (
              <Toggle
                key={skill}
                value={skill}
                className="h-[26px] rounded-[2px] border-0 bg-transparent text-muted aria-pressed:bg-raised aria-pressed:text-text"
              >
                {skillLabels[skill]}
              </Toggle>
            ))}
          </ToggleGroup>
          {enemies.length > 0 ? (
            <label className="flex items-center gap-2">
              <Checkbox
                className="flex size-4 items-center justify-center rounded-[2px] border border-line bg-bg p-0 text-ember-foreground aria-checked:border-ember aria-checked:bg-ember"
                checked={enemies.every((thing) => thing.ambush)}
                onCheckedChange={(checked) =>
                  onChange((thing) =>
                    thingCatalog[thing.kind].category === "enemy"
                      ? { ambush: checked === true || undefined }
                      : {},
                  )
                }
              >
                <CheckboxIndicator>
                  <Check size={12} aria-hidden="true" />
                </CheckboxIndicator>
              </Checkbox>
              Wait until player is seen
            </label>
          ) : null}
        </InspectorSection>
      ) : null}
    </>
  );
}

function ThingInspector({
  map,
  things,
  placing,
  onChange,
  onPlace,
}: {
  map: GameMap;
  things: Thing[];
  placing: ThingKind;
  onChange: (change: ThingChange) => void;
  onPlace: (kind: ThingKind) => void;
}) {
  return (
    <>
      {things.length > 0 ? (
        <ThingFields
          key={things.map((thing) => thing.id).join()}
          things={things}
          onChange={onChange}
        />
      ) : null}
      <PlaceThings kind={placing} onPick={onPlace} />
      <BalancePanel map={map} />
    </>
  );
}

function SwitchInspector({
  item,
  doors,
  assets,
  light,
  onChange,
}: {
  item: MapSwitch;
  doors: Sector[];
  assets: SceneAssets;
  light: number;
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
        picture={assets.texture}
        assets={assets}
        light={light}
        whole
        onChange={(texture) => onChange({ texture })}
      />
    </div>
  );
}

export { LineInspector, SectorInspector, SwitchInspector, ThingInspector };
