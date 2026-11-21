import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import {
  NumberInput,
  NumberInputControl,
  NumberInputGroup,
} from "@ui-sdk/react/number-input";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { Check, Search, TriangleAlert } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

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
  lineActionGroups,
  lineActionKinds,
  lineActions,
  lineUsesTag,
  newLineAction,
  triggerLabels,
  triggersFor,
  usedFromFront,
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
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupInput } from "../components/ui/input";
import {
  Select,
  SelectCheck,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { FieldItem, Label } from "../components/ui/field";
import { NumberField } from "../components/ui/number-field";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../components/ui/segmented-control";
import { Slider, SliderValue } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";

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
    <details className="inspector-section" open>
      <summary>
        <h2>
          {title}
          {detail ? <span>{detail}</span> : null}
        </h2>
      </summary>
      <div className="flex flex-col gap-2.5">{children}</div>
    </details>
  );
}

function NumberSetting({
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
  const browseButton = useRef<HTMLButtonElement>(null);
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
          ref={browseButton}
          type="button"
          aria-label={`Browse ${label.toLowerCase()} textures`}
          title="Browse textures"
          className="size-12 cursor-pointer rounded-[3px] border-0 bg-transparent p-0 outline-offset-1 hover:outline-2 hover:outline-primary"
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
        <FieldItem>
          <SelectLabel>{label}</SelectLabel>
          <SelectTrigger>
            <SelectValue />
            <span aria-hidden="true">▾</span>
          </SelectTrigger>
        </FieldItem>
        <SelectContent>
          {items.map((option) => (
            <SelectItem key={option} value={option}>
              <TextureSwatch
                name={option}
                picture={picture(option)}
                assets={assets}
                light={light}
                whole={whole}
                className="size-8 shrink-0 rounded-xs [image-rendering:pixelated]"
              />
              {option}
              <SelectCheck />
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
          onClose={() => {
            setBrowsing(false);
            requestAnimationFrame(() => browseButton.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

type Choice = { value: string; label: string; short?: string };

function ChoiceField({
  label,
  value,
  items,
  groups = [],
  onChange,
}: {
  label: string;
  value: string;
  items: Choice[];
  groups?: { label: string; items: Choice[] }[];
  onChange: (value: string) => void;
}) {
  const option = (item: Choice) => (
    <SelectItem key={item.value} value={item.value}>
      {item.short ?? item.label}
      <SelectCheck />
    </SelectItem>
  );
  return (
    <Select
      value={value}
      items={[...items, ...groups.flatMap((group) => group.items)].map(
        (item) => ({ value: item.value, label: item.label }),
      )}
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
        {items.map(option)}
        {groups.map((group) => (
          <SelectGroup key={group.label}>
            <SelectGroupLabel className="px-2 pt-2 pb-1 font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {group.label}
            </SelectGroupLabel>
            {group.items.map(option)}
          </SelectGroup>
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
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
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
      <ToggleField
        label="Opens fast"
        checked={Boolean(door.fast)}
        onChange={(fast) => onChange({ ...door, fast: fast || undefined })}
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
      <InspectorSection
        title="Height"
        detail={door ? undefined : String(sector.ceiling - sector.floor)}
      >
        <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1">
          {door ? null : (
            <NumberSetting
              label="Ceiling"
              value={sector.ceiling}
              step={8}
              min={-1024}
              max={2048}
              onChange={(ceiling) => onChange({ ceiling })}
            />
          )}
          <NumberSetting
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
          label="Light level"
          value={sector.light}
          min={0}
          max={255}
          step={1}
          onValueChange={(light) => onChange({ light: light as number })}
        >
          <div className="flex justify-between tabular-nums">
            <Label>Light level</Label>
            <SliderValue />
          </div>
        </Slider>
        <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1 items-end">
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
          <NumberSetting
            label="Tag"
            value={sector.tag ?? 0}
            step={1}
            min={0}
            max={tagLimit}
            onChange={(tag) => onChange({ tag: tag || undefined })}
          />
        </div>
      </InspectorSection>
      <InspectorSection title="Door">
        <ToggleField
          label="Opens as a door"
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
  onAddSwitch,
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
  onAddSwitch?: () => void;
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
            className="self-start"
            value={line.isBack ? back.id : front.id}
            onValueChange={(next) => onSelectSide(next as string)}
          >
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
        <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1">
          <NumberSetting
            label="Offset X"
            value={side?.offsetX ?? 0}
            step={1}
            min={-offsetLimit}
            max={offsetLimit}
            onChange={(offsetX) =>
              onSideChange({ offsetX: offsetX || undefined })
            }
          />
          <NumberSetting
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
          <Button
            onClick={() => {
              const field = fields.find(({ info }) => info.paints === "wall")!;
              onPaint(field.part, field.info.texture!, true);
            }}
          >
            Use on every wall in this room
          </Button>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Action">
        {line.wiredSwitch ? (
          <p className="text-muted-foreground">
            The switch on this line opens its door.
          </p>
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
              ]}
              groups={lineActionGroups(
                lineActionKinds.filter(
                  (value) =>
                    value === action?.kind ||
                    triggersFor(value, twoSided).length > 0,
                ),
              )}
              onChange={(kind) => {
                if (!isLineActionKind(kind)) {
                  onLineChange({ action: undefined });
                } else if (action) {
                  changeAction({ kind });
                } else {
                  onLineChange({
                    action: newLineAction(twoSided, kind),
                    scrolls: undefined,
                  });
                }
              }}
            />
            {onAddSwitch && !action && !settings.scrolls ? (
              <Button className="self-start" onClick={onAddSwitch}>
                Add a switch
              </Button>
            ) : null}
            {action ? (
              <>
                <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1 items-end">
                  <ChoiceField
                    label="Trigger"
                    value={action.trigger}
                    items={(triggersFor(action.kind, twoSided).length > 0
                      ? triggersFor(action.kind, twoSided)
                      : [action.trigger]
                    ).map((value) => ({
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
                    label={lineActions[action.kind].target ?? "Moves sector"}
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
                {back && !front.door && !back.door && usedFromFront(action) ? (
                  <ChoiceField
                    label="Works from"
                    value={front.id}
                    items={[front, back].map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    onChange={(next) => onLineChange({ front: next })}
                  />
                ) : null}
              </>
            ) : opensDoor ? null : (
              <>
                <ToggleField
                  label="Texture scrolls"
                  checked={Boolean(settings.scrolls)}
                  onChange={(checked) =>
                    onLineChange({ scrolls: checked || undefined })
                  }
                />
                {settings.scrolls && back && !front.door && !back.door ? (
                  <ChoiceField
                    label="Scrolls on"
                    value={front.id}
                    items={[front, back].map((item) => ({
                      value: item.id,
                      label: `${item.name} side`,
                    }))}
                    onChange={(next) => onLineChange({ front: next })}
                  />
                ) : null}
              </>
            )}
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
    <FieldItem className="min-w-0 flex-1">
      <Label>{label}</Label>
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          if (next !== null) onChange(Math.round(next));
        }}
      >
        <NumberInputGroup className="flex h-8 items-center rounded-[3px] border border-input px-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring">
          <NumberInputControl
            aria-label={label}
            className="w-full min-w-0 border-0 bg-transparent font-mono text-xs tabular-nums outline-none"
          />
          {suffix ? (
            <span className="font-mono text-xs text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </NumberInputGroup>
      </NumberInput>
    </FieldItem>
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
        <Label>{label}</Label>
        <span className="font-mono text-xs">{value}</span>
      </div>
      <div className="h-1 bg-muted">
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
        color="var(--color-thing-enemy)"
      />
      <Meter
        label="Health pickups"
        value={health}
        fill={health / (health + healthShort || 1)}
        color="var(--color-thing-health)"
      />
      <Meter
        label="Ammo pickups"
        value={ammo}
        fill={ammo / (ammo + ammoShort || 1)}
        color="var(--color-thing-item)"
      />
      <Meter
        label="Keys"
        value={keys}
        fill={keys / (keys + keysNeeded || 1)}
        color="var(--color-key-yellow)"
      />
      {advice.length > 0 ? (
        <p className="flex gap-2">
          <TriangleAlert
            size={14}
            className="mt-0.5 shrink-0 text-warning"
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
      <InputGroup className="h-8">
        <Search
          size={14}
          className="text-muted-foreground"
          aria-hidden="true"
        />
        <InputGroupInput
          aria-label="Search things"
          placeholder="Search things"
          value={query}
          onValueChange={setQuery}
        />
      </InputGroup>
      <SegmentedControl
        aria-label="Thing type"
        className="w-full [&>button]:flex-1 [&>button]:px-1"
        value={tab}
        onValueChange={(next) => setTab(next as ThingTab)}
      >
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
                className="grid h-[58px] min-w-0 content-center justify-items-center gap-1 rounded-[2px] border-0 bg-muted px-1 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-primary/15 aria-pressed:text-foreground"
                onClick={() => onPick(item)}
              >
                <Icon
                  size={18}
                  style={{ color: active ? "var(--color-primary)" : color }}
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
        <p className="text-muted-foreground">No things match.</p>
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
  const placed = things.filter(
    (thing) => thingCatalog[thing.kind].category !== "start",
  );
  const enemies = things.filter(
    (thing) => thingCatalog[thing.kind].category === "enemy",
  );
  const pressed = allSkills.filter((skill) =>
    placed.every((thing) => appearsOn(thing.skills, skill)),
  );
  const toggleSkill = (skill: ThingSkill, on: boolean) =>
    onChange((thing) => {
      if (thingCatalog[thing.kind].category === "start") return {};
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
            className="grid grid-cols-3 gap-0.5 rounded-[3px] bg-background p-0.5"
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
                className="h-[26px] rounded-[2px] border-0 bg-transparent text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset"
              >
                {skillLabels[skill]}
              </Toggle>
            ))}
          </ToggleGroup>
          {enemies.length > 0 ? (
            <label className="flex items-center gap-2">
              <Checkbox
                className="flex size-4 items-center justify-center rounded-[2px] border border-input bg-transparent p-0 text-primary-foreground aria-checked:border-primary aria-checked:bg-primary"
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
    <div className="flex flex-col gap-2.5">
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
