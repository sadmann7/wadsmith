import {
  NumberInput,
  NumberInputControl,
  NumberInputGroup,
} from "@ui-sdk/react/number-input";
import { Search, TriangleAlert } from "lucide-react";
import * as React from "react";

import type {
  Complevel,
  DoorSettings,
  GameMap,
  KeyColor,
  LineActionKind,
  LineSettings,
  LineSide,
  LineTrigger,
  MapSwitch,
  Sector,
  SectorEffect,
  Thing,
  ThingKind,
  ThingSkill,
} from "@/lib/map/types";
import type { SceneAssets } from "@/lib/wad/assets";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldItem, Label } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
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
} from "@/components/ui/select";
import { Slider, SliderValue } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import { thingIcons } from "@/lib/editor/thing-icons";
import { appearsOn, mapBalance } from "@/lib/map/balance";
import {
  altDamageLabels,
  damageLabels,
  decodeSectorSpecial,
  encodeSectorSpecial,
  fieldValue,
  generalizedClass,
  generalizedFields,
  generalizedKind,
  generalizedKinds,
  generalizedTrigger,
  getIsDoorClass,
  newGeneralized,
  sectorBases,
  type SectorBits,
  sectorSpecialOf,
  sectorSpecialPatch,
  withField,
} from "@/lib/map/boom";
import {
  ceilingTextures,
  doorTextures,
  floorTextures,
  sectorEffects,
  swappableKinds,
  switchTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
} from "@/lib/map/catalog";
import { atLeast } from "@/lib/map/complevel";
import {
  defaultDoor,
  freeTag,
  gridSize,
  type RoomNumber,
} from "@/lib/map/edit";
import { containerOf } from "@/lib/map/geometry";
import {
  describeLine,
  fitLineAction,
  getCanRepeatChoice,
  getIsLineActionKind,
  keysFor,
  lineActionGroups,
  lineActionKinds,
  lineActions,
  type LineSides,
  lineUsesTag,
  newLineAction,
  triggerChoices,
  triggerLabels,
  triggersFor,
  usedFromFront,
} from "@/lib/map/lines";
import { describeWalls, type LineFlag } from "@/lib/map/many-lines";
import { describeSurface, surfaceKey, type WallPart } from "@/lib/map/surfaces";
import { flatUse, type TextureUse, wallUse } from "@/lib/map/textures";
import { rankByQuery } from "@/lib/search";

import { TextureSwatch } from "./surface-panel";
import { type TextureKind, TexturePicker } from "./texture-picker";

type ThingTab = "enemy" | "item" | "key" | "decor";

const skillLabels: Record<ThingSkill, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const offsetLimit = 32767;
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
  { flag: "soundBlock", label: "Blocks sound" },
  { flag: "upperFixed", label: "Keep upper texture fixed" },
  { flag: "lowerFixed", label: "Keep lower texture fixed" },
  { flag: "hidden", label: "Hide on automap" },
  { flag: "secret", label: "Look solid on automap" },
  { flag: "mapped", label: "Show on automap from the start" },
  { flag: "passUse", label: "Let use pass through (Boom)" },
];

const rawSpecialLimit = 32767;
const vanillaSectorTypes = 31;

interface Choice {
  value: string;
  label: string;
  short?: string;
}

interface SectorInspectorProps {
  map: GameMap;
  sector: Sector;
  assets: SceneAssets;
  onChange: (patch: Partial<Sector>) => void;
}

export function SectorInspector({
  map,
  sector,
  assets,
  onChange,
}: SectorInspectorProps) {
  const { door } = sector;
  const level = map.complevel ?? "vanilla";
  const special = sectorSpecialOf(sector);
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
        {atLeast(level, "boom") || special > vanillaSectorTypes ? (
          <BoomSectorFields
            special={special}
            level={level}
            tag={sector.tag ?? 0}
            free={freeTag(map)}
            onChange={(next) => onChange(sectorSpecialPatch(next))}
            onTagChange={(tag) => onChange({ tag: tag || undefined })}
          />
        ) : (
          <div className="flex items-center items-end gap-2 [&>*]:min-w-0 [&>*]:flex-1">
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
                  rawEffect: undefined,
                })
              }
            />
            {sector.effect ? null : (
              <NumberSetting
                label="Special number"
                value={sector.rawEffect ?? 0}
                step={1}
                min={0}
                max={rawSpecialLimit}
                onChange={(rawEffect) =>
                  onChange({ rawEffect: rawEffect || undefined })
                }
              />
            )}
            <TagSetting
              value={sector.tag ?? 0}
              free={freeTag(map)}
              onChange={(tag) => onChange({ tag: tag || undefined })}
            />
          </div>
        )}
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

const mixed = "Mixed";

interface RoomsInspectorProps {
  map: GameMap;
  rooms: Sector[];
  assets: SceneAssets;
  onChange: (patch: Partial<Sector>) => void;
  onShift: (key: RoomNumber, delta: number) => void;
  // True makes every room a door, false makes none one, and settings change
  // every door's.
  onDoor: (change: boolean | Partial<DoorSettings>) => void;
}

export function RoomsInspector({
  map,
  rooms,
  assets,
  onChange,
  onShift,
  onDoor,
}: RoomsInspectorProps) {
  const [first] = rooms;
  // What every room agrees on, or null where they differ. A door has no
  // ceiling height of its own, so it has no say in that one.
  const shared = (key: RoomNumber) => {
    const having =
      key === "ceiling" ? rooms.filter((room) => !room.door) : rooms;
    return having.length > 0 &&
      having.every((room) => room[key] === having[0][key])
      ? having[0][key]
      : null;
  };
  const texture = (key: "floorTexture" | "ceilingTexture" | "wallTexture") =>
    rooms.every((room) => room[key] === first[key]) ? first[key] : mixed;
  const context = `${rooms.length} rooms`;
  const flats = { kind: "flat" as const, use: flatUse(map), context };
  const light = shared("light");
  const effect = agreed(
    rooms.map(
      (room) =>
        room.effect ?? (room.rawEffect ? `raw:${room.rawEffect}` : "none"),
    ),
  );
  const tag = agreed(rooms.map((room) => room.tag ?? 0));
  const doors = rooms.every((room) => room.door);
  // What every door agrees on, or null where they differ.
  const door = <K extends keyof DoorSettings>(key: K) =>
    agreed(rooms.map((room) => room.door?.[key]));
  // The field lists Mixed as a value, which choosing again changes nothing.
  const paint =
    (patch: (name: string) => Partial<Sector>) => (name: string) => {
      if (name !== mixed) onChange(patch(name));
    };
  return (
    <>
      <InspectorSection title="Height" detail={context}>
        <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1">
          {rooms.every((room) => room.door) ? null : (
            <NumberSetting
              label="Ceiling"
              value={shared("ceiling")}
              step={8}
              min={-1024}
              max={2048}
              onChange={(ceiling) => onChange({ ceiling })}
              onShift={(delta) => onShift("ceiling", delta)}
            />
          )}
          <NumberSetting
            label="Floor"
            value={shared("floor")}
            step={8}
            min={-1024}
            max={1024}
            onChange={(floor) => onChange({ floor })}
            onShift={(delta) => onShift("floor", delta)}
          />
        </div>
      </InspectorSection>
      <InspectorSection title="Surfaces">
        <TextureField
          picture={assets.flat}
          assets={assets}
          label="Floor"
          value={texture("floorTexture")}
          options={floorTextures}
          browse={flats}
          light={light ?? first.light}
          onChange={paint((floorTexture) => ({ floorTexture }))}
        />
        <TextureField
          picture={assets.flat}
          assets={assets}
          label="Ceiling"
          value={texture("ceilingTexture")}
          options={ceilingTextures}
          browse={flats}
          light={light ?? first.light}
          onChange={paint((ceilingTexture) => ({ ceilingTexture }))}
        />
        <TextureField
          picture={assets.texture}
          assets={assets}
          label="Walls"
          value={texture("wallTexture")}
          options={wallTextures}
          browse={{ kind: "wall", use: wallUse(map), context }}
          light={light ?? first.light}
          onChange={paint((wallTexture) => ({ wallTexture }))}
        />
      </InspectorSection>
      <InspectorSection title="Behaviour">
        <NumberSetting
          label="Light level"
          value={light}
          step={8}
          min={0}
          max={255}
          onChange={(next) => onChange({ light: next })}
          onShift={(delta) => onShift("light", delta)}
        />
        <div className="flex items-center items-end gap-2 [&>*]:min-w-0 [&>*]:flex-1">
          <ChoiceField
            label="Effect"
            value={effect ?? mixed}
            items={[
              ...(effect === null ? [{ value: mixed, label: mixed }] : []),
              ...(effect?.startsWith("raw:")
                ? [{ value: effect, label: `Special ${effect.slice(4)}` }]
                : []),
              { value: "none", label: "None" },
              ...Object.entries(sectorEffects).map(([value, { label }]) => ({
                value,
                label,
              })),
            ]}
            onChange={(next) => {
              if (next === mixed || next.startsWith("raw:")) return;
              onChange({
                effect: next === "none" ? undefined : (next as SectorEffect),
                rawEffect: undefined,
              });
            }}
          />
          <TagSetting
            value={tag}
            free={freeTag(map)}
            onChange={(next) => onChange({ tag: next || undefined })}
          />
        </div>
      </InspectorSection>
      <InspectorSection title="Door">
        <ToggleField label="Open as doors" checked={doors} onChange={onDoor} />
        {doors && first.door ? (
          <>
            <ChoiceField
              label="Opens with"
              value={door("opensBy") ?? mixed}
              items={[
                ...(door("opensBy") === null
                  ? [{ value: mixed, label: mixed }]
                  : []),
                { value: "use", label: "Use key" },
                { value: "switch", label: "Switch" },
              ]}
              onChange={(opensBy) => {
                if (opensBy !== mixed) {
                  onDoor({ opensBy: opensBy as DoorSettings["opensBy"] });
                }
              }}
            />
            <ToggleField
              label="Close again"
              checked={door("closes") === true}
              onChange={(closes) => onDoor({ closes })}
            />
            <ToggleField
              label="Open fast"
              checked={door("fast") === true}
              onChange={(fast) => onDoor({ fast: fast || undefined })}
            />
            <TextureField
              label="Door texture"
              value={door("texture") ?? mixed}
              options={doorTextures}
              picture={assets.texture}
              assets={assets}
              light={light ?? first.light}
              whole
              onChange={(texture) => {
                if (texture !== mixed) onDoor({ texture });
              }}
            />
          </>
        ) : null}
      </InspectorSection>
    </>
  );
}

interface LineInspectorProps {
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
  // Unset while the walls beside this one already carry its texture on.
  onAlign?: () => void;
}

export function LineInspector({
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
  onAlign,
}: LineInspectorProps) {
  const line = describeLine(map, wall, sector);
  const { settings, twoSided, front, back } = line;
  const side = settings.sides?.[line.sector.id];
  const { action } = settings;
  // A line inside a room has only a middle texture, chosen below.
  const detail = back !== null && back === front;
  const parts: WallPart[] = detail
    ? []
    : twoSided
      ? ["upper", "lower"]
      : ["middle"];
  const fields = parts.flatMap((part) => {
    const info = describeSurface(
      map,
      surfaceKey({ kind: "wall", sector: line.sector.id, wall, part }),
    );
    return info?.paints && info.texture
      ? [{ part, info, texture: info.texture }]
      : [];
  });
  const opensDoor = back?.door?.opensBy === "use";
  const roomWall = fields.find(
    ({ info, texture }) =>
      info.paints === "wall" &&
      (wallTextures as readonly string[]).includes(texture),
  );
  const doorFace = fields.find(({ info }) => info.paints === "door");
  const target = action?.tag
    ? map.sectors.find((item) => item.tag === action.tag)
    : undefined;
  const level = map.complevel ?? "vanilla";
  const { raw } = settings;
  const generalized = raw && !action ? generalizedKind(raw.special) : null;
  const boomOffered = (atLeast(level, "boom") && !opensDoor) || generalized;
  // A switch, a shot or a press works from the line's front only.
  const frontMatters = action
    ? usedFromFront(action)
    : generalized && raw
      ? generalizedTrigger(raw.special).trigger !== "walk"
      : false;
  // Door tracks and switch art are pegged to the floor unless told otherwise.
  const peggedByDefault =
    line.mapSwitch !== null || (!twoSided && Boolean(line.sector.door));
  const changeAction = (patch: Partial<NonNullable<typeof action>>) => {
    if (action) {
      onLineChange({
        action: fitLineAction(
          { ...action, ...patch },
          line,
          patch.kind === undefined ? action.trigger : undefined,
        ),
      });
    }
  };

  return (
    <>
      <InspectorSection title="Wall textures">
        {back && !detail ? (
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
        {fields.map(({ part, info, texture }) => (
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
            value={texture}
            options={info.textures}
            onChange={(texture) => onPaint(part, texture)}
          />
        ))}
        {back && !front.door && !back.door ? (
          <>
            <ToggleField
              label="See-through middle"
              checked={Boolean(side?.middle)}
              onChange={(checked) =>
                onSideChange({ middle: checked ? "MIDGRATE" : undefined })
              }
            />
            {side?.middle ? (
              <TextureField
                label="Middle"
                picture={assets.texture}
                assets={assets}
                light={line.sector.light}
                whole
                value={side.middle}
                options={assets.names.middles}
                onChange={(middle) => onSideChange({ middle })}
              />
            ) : null}
          </>
        ) : null}
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
        {detail ? null : (
          <Button
            disabled={!onAlign}
            title="Carries this wall's texture on unbroken along the walls beside it"
            onClick={onAlign}
          >
            Align along the room
          </Button>
        )}
        {roomWall ? (
          <Button
            onClick={() => onPaint(roomWall.part, roomWall.texture, true)}
          >
            Use on every wall in this room
          </Button>
        ) : null}
        {doorFace ? (
          <Button
            onClick={() => onPaint(doorFace.part, doorFace.texture, true)}
          >
            Use on the whole door
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
              value={
                generalized
                  ? `boom:${generalized.class}`
                  : (action?.kind ?? "none")
              }
              items={[
                {
                  value: "none",
                  label: opensDoor ? "From door settings" : "Nothing",
                },
              ]}
              groups={[
                ...lineActionGroups(
                  lineActionKinds.filter(
                    (value) =>
                      value === action?.kind ||
                      triggersFor(value, line).length > 0,
                  ),
                ),
                ...(boomOffered
                  ? [
                      {
                        label: "Boom",
                        items: generalizedKinds.map((kind) => ({
                          value: `boom:${kind.class}`,
                          label: kind.label,
                          short: kind.label.replace(/^Boom /, ""),
                        })),
                      },
                    ]
                  : []),
              ]}
              onChange={(kind) => {
                const boom = kind.startsWith("boom:")
                  ? generalizedClass(kind.slice("boom:".length))
                  : null;
                if (boom) {
                  onLineChange({
                    action: undefined,
                    scrolls: undefined,
                    shut: undefined,
                    raw: {
                      special: newGeneralized(boom, line),
                      tag: settings.raw?.tag ?? 0,
                    },
                  });
                } else if (!getIsLineActionKind(kind)) {
                  onLineChange({
                    action: undefined,
                    raw: generalized ? undefined : settings.raw,
                  });
                } else if (action) {
                  changeAction({ kind });
                } else {
                  onLineChange({
                    action: newLineAction(line, kind),
                    scrolls: undefined,
                    shut: undefined,
                    raw: undefined,
                  });
                }
              }}
            />
            {onAddSwitch && !action && !settings.scrolls && !generalized ? (
              <Button className="self-start" onClick={onAddSwitch}>
                Add a switch
              </Button>
            ) : null}
            {opensDoor && !action && !generalized ? (
              <ToggleField
                label="Opens the door from this side"
                checked={!settings.shut}
                onChange={(checked) =>
                  onLineChange({ shut: checked ? undefined : true })
                }
              />
            ) : null}
            {generalized && raw ? (
              <BoomLineFields
                map={map}
                special={raw.special}
                tag={raw.tag}
                sides={line}
                onChange={(special) =>
                  onLineChange({
                    raw: { special, tag: raw.tag },
                  })
                }
                onTargetChange={onTargetChange}
              />
            ) : action ? (
              <>
                <div className="flex items-center items-end gap-2 [&>*]:min-w-0 [&>*]:flex-1">
                  <ChoiceField
                    label="Trigger"
                    value={action.trigger}
                    items={triggerChoices(action, line).map((value) => ({
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
                {getCanRepeatChoice(action) ? (
                  <ToggleField
                    label="Can repeat"
                    checked={action.repeat}
                    onChange={(repeat) => changeAction({ repeat })}
                  />
                ) : null}
              </>
            ) : opensDoor ? null : (
              <>
                <ToggleField
                  label="Texture scrolls"
                  checked={Boolean(settings.scrolls)}
                  onChange={(checked) =>
                    onLineChange({
                      scrolls: checked || undefined,
                      raw: checked ? undefined : settings.raw,
                    })
                  }
                />
                {settings.scrolls && detail ? (
                  <p className="text-muted-foreground">
                    Scrolls on the right-hand side of the direction it was drawn
                    in. Flip line in its menu turns it around.
                  </p>
                ) : null}
                {settings.scrolls &&
                back &&
                !detail &&
                !front.door &&
                !back.door ? (
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
            {frontMatters && detail ? (
              <p className="text-muted-foreground">
                Works from the right-hand side of the direction it was drawn in.
                Flip line in its menu turns it around.
              </p>
            ) : null}
            {frontMatters && back && !detail && !front.door && !back.door ? (
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
        )}
        {!line.wiredSwitch && !action && !opensDoor ? (
          <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1">
            <NumberSetting
              label="Special number"
              value={settings.raw?.special ?? 0}
              step={1}
              min={0}
              max={rawSpecialLimit}
              onChange={(special) =>
                onLineChange({
                  raw: special
                    ? { special, tag: settings.raw?.tag ?? 0 }
                    : undefined,
                  scrolls: special ? undefined : settings.scrolls,
                })
              }
            />
            {raw ? (
              <TagSetting
                value={raw.tag}
                free={freeTag(map)}
                onChange={(tag) =>
                  onLineChange({
                    raw: { special: raw.special, tag },
                  })
                }
              />
            ) : null}
          </div>
        ) : null}
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
        {settings.solid ||
        (back && !back.door && containerOf(map, front)?.id === back.id) ? (
          <ToggleField
            label="Solid towards the room around it"
            checked={Boolean(settings.solid)}
            onChange={(checked) =>
              onLineChange({ solid: checked || undefined })
            }
          />
        ) : null}
        {lineFlags.map(({ flag, label }) =>
          flag === "lowerFixed" && peggedByDefault ? (
            <ToggleField
              key={flag}
              label="Pegged to the floor"
              checked={settings.lowerFixed !== false}
              onChange={(checked) =>
                onLineChange({ lowerFixed: checked ? undefined : false })
              }
            />
          ) : (
            <ToggleField
              key={flag}
              label={label}
              checked={Boolean(settings[flag])}
              onChange={(checked) =>
                onLineChange({ [flag]: checked || undefined })
              }
            />
          ),
        )}
      </InspectorSection>
    </>
  );
}

interface LinesInspectorProps {
  map: GameMap;
  walls: string[];
  assets: SceneAssets;
  onPaint: (texture: string) => void;
  onOffset: (key: "offsetX" | "offsetY", value: number, shift: boolean) => void;
  onFlag: (flag: LineFlag, on: boolean) => void;
  onAction: (kind: LineActionKind | null) => void;
  onTag: (tag: number) => void;
}

export function LinesInspector({
  map,
  walls,
  assets,
  onPaint,
  onOffset,
  onFlag,
  onAction,
  onTag,
}: LinesInspectorProps) {
  const look = describeWalls(map, walls);
  const context = `${walls.length} lines`;
  return (
    <>
      <InspectorSection title="Wall textures" detail={context}>
        {look.showing ? (
          <TextureField
            picture={assets.texture}
            assets={assets}
            label="Wall"
            value={look.texture ?? mixed}
            options={wallTextures}
            browse={{ kind: "wall", use: wallUse(map), context }}
            light={255}
            onChange={(texture) => {
              if (texture !== mixed) onPaint(texture);
            }}
          />
        ) : (
          <p className="text-muted-foreground">
            The rooms on either side are level, so these lines show no wall.
          </p>
        )}
        <div className="flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1">
          <NumberSetting
            label="Offset X"
            value={look.offsetX}
            step={1}
            min={-offsetLimit}
            max={offsetLimit}
            onChange={(value) => onOffset("offsetX", value, false)}
            onShift={(delta) => onOffset("offsetX", delta, true)}
          />
          <NumberSetting
            label="Offset Y"
            value={look.offsetY}
            step={1}
            min={-offsetLimit}
            max={offsetLimit}
            onChange={(value) => onOffset("offsetY", value, false)}
            onShift={(delta) => onOffset("offsetY", delta, true)}
          />
        </div>
      </InspectorSection>
      <InspectorSection title="Action">
        <ChoiceField
          label="When triggered"
          value={look.action ?? mixed}
          items={[
            ...(look.action === null ? [{ value: mixed, label: mixed }] : []),
            ...(look.action === "raw"
              ? [{ value: "raw", label: "Special by number" }]
              : []),
            { value: "none", label: "Nothing" },
          ]}
          groups={lineActionGroups([...lineActionKinds])}
          onChange={(kind) => {
            if (kind === mixed || kind === "raw") return;
            onAction(getIsLineActionKind(kind) ? kind : null);
          }}
        />
        {look.tagged ? (
          <TagSetting value={look.tag} free={freeTag(map)} onChange={onTag} />
        ) : null}
      </InspectorSection>
      <InspectorSection title="Flags">
        {[
          ...(look.twoSided
            ? [{ flag: "blocksAll", label: "Blocks players and enemies" }]
            : []),
          ...lineFlags,
        ].map(({ flag, label }) => (
          <ToggleField
            key={flag}
            label={label}
            checked={look.flags[flag as LineFlag]}
            onChange={(checked) => onFlag(flag as LineFlag, checked)}
          />
        ))}
      </InspectorSection>
    </>
  );
}

type ThingChange = (thing: Thing) => Partial<Omit<Thing, "id">>;

interface ThingInspectorProps {
  map: GameMap;
  things: Thing[];
  placing: ThingKind | null;
  kinds?: readonly ThingKind[];
  grid?: number;
  onChange: (change: ThingChange) => void;
  onPlace: (kind: ThingKind | null) => void;
}

export function ThingInspector({
  map,
  things,
  placing,
  kinds = thingKinds,
  grid = gridSize,
  onChange,
  onPlace,
}: ThingInspectorProps) {
  return (
    <>
      {things.length > 0 ? (
        <ThingFields
          key={things.map((thing) => thing.id).join()}
          things={things}
          grid={grid}
          onChange={onChange}
        />
      ) : null}
      <PlaceThings kind={placing} kinds={kinds} onPick={onPlace} />
      <BalancePanel map={map} />
    </>
  );
}

interface SwitchInspectorProps {
  item: MapSwitch;
  doors: Sector[];
  assets: SceneAssets;
  light: number;
  onChange: (patch: Partial<MapSwitch>) => void;
}

export function SwitchInspector({
  item,
  doors,
  assets,
  light,
  onChange,
}: SwitchInspectorProps) {
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

function agreed<T>(values: T[]) {
  return values.every((value) => value === values[0]) ? values[0] : null;
}

interface ChoiceFieldProps {
  label: string;
  value: string;
  items: Choice[];
  groups?: { label: string; items: Choice[] }[];
  onChange: (value: string) => void;
}

function ChoiceField({
  label,
  value,
  items,
  groups = [],
  onChange,
}: ChoiceFieldProps) {
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
        {items.map(choiceItem)}
        {groups.map((group) => (
          <SelectGroup key={group.label}>
            <SelectGroupLabel className="px-2 pt-2 pb-1 font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {group.label}
            </SelectGroupLabel>
            {group.items.map(choiceItem)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function choiceItem(item: Choice) {
  return (
    <SelectItem key={item.value} value={item.value}>
      {item.short ?? item.label}
      <SelectCheck />
    </SelectItem>
  );
}

interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleField({ label, checked, onChange }: ToggleFieldProps) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

interface TextureFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  picture: SceneAssets["texture"];
  assets: SceneAssets;
  light: number;
  whole?: boolean;
  browse?: { kind: TextureKind; use: TextureUse; context: string };
  onChange: (value: string) => void;
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
}: TextureFieldProps) {
  const [browsing, setBrowsing] = React.useState(false);
  const browseButton = React.useRef<HTMLButtonElement>(null);
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

interface NumberSettingProps {
  label: string;
  // Null leaves the field empty, for rooms that don't agree on the value.
  value: number | null;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  // A step from an empty field, which moves each room from where it is.
  onShift?: (delta: number) => void;
}

function NumberSetting({
  label,
  value,
  step,
  min,
  max,
  onChange,
  onShift,
}: NumberSettingProps) {
  return (
    <FieldItem>
      <Label>{label}</Label>
      <NumberField
        label={label}
        value={value}
        placeholder={value === null ? mixed : undefined}
        step={step}
        min={min}
        max={max}
        onValueChange={(next, details) => {
          if (next === null) return;
          const typed =
            details.reason === "input-change" ||
            details.reason === "input-commit";
          // An empty field has nothing to step from, so a step moves each
          // room from where it stands, and only a typed number sets them all.
          if (value !== null || typed) onChange(Math.round(next));
          else onShift?.(stepWay(details) * step);
        }}
      />
    </FieldItem>
  );
}

// Which way a step went, read from what caused it: the field counts from zero
// when it is empty, and its limits hide the direction.
function stepWay(details: { reason: string; event?: Event }) {
  if (details.reason === "increment-press") return 1;
  if (details.reason === "decrement-press") return -1;
  const key =
    details.reason === "step-key" && details.event instanceof KeyboardEvent
      ? details.event.key
      : "";
  if (key === "ArrowUp" || key === "PageUp") return 1;
  return key === "ArrowDown" || key === "PageDown" ? -1 : 0;
}

const tagLimit = 32767;

interface TagSettingProps {
  // Null leaves the field empty, where the items don't agree.
  value: number | null;
  free: number;
  onChange: (tag: number) => void;
}

function TagSetting({ value, free, onChange }: TagSettingProps) {
  return (
    <FieldItem>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Tag</Label>
        <Button
          variant="text"
          className="text-xs"
          title={`Use tag ${free}, which nothing uses yet`}
          onClick={() => onChange(free)}
        >
          Free tag
        </Button>
      </div>
      <NumberField
        label="Tag"
        value={value}
        placeholder={value === null ? mixed : undefined}
        step={1}
        min={0}
        max={tagLimit}
        onValueChange={(next, details) => {
          if (next === null) return;
          // Items with different tags have nothing to step from, so only a
          // typed tag sets them all.
          const typed =
            details.reason === "input-change" ||
            details.reason === "input-commit";
          if (value !== null || typed) onChange(Math.round(next));
        }}
      />
    </FieldItem>
  );
}

interface InspectorSectionProps {
  title: string;
  detail?: string;
  children: React.ReactNode;
}

function InspectorSection({ title, detail, children }: InspectorSectionProps) {
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

interface BoomSectorFieldsProps {
  special: number;
  level: Complevel;
  tag: number;
  free: number;
  onChange: (special: number) => void;
  onTagChange: (tag: number) => void;
}

// Boom reads a vanilla effect from the low bits of a sector's special and the
// rest from bits above it, so the fields edit one number together.
function BoomSectorFields({
  special,
  level,
  tag,
  free,
  onChange,
  onTagChange,
}: BoomSectorFieldsProps) {
  const bits = decodeSectorSpecial(special);
  const set = (patch: Partial<SectorBits>) =>
    onChange(encodeSectorSpecial({ ...bits, ...patch }));
  const exitSpecial = sectorEffects["damage-20-exit"].special;
  const exit = special === exitSpecial;
  const known =
    bits.base === 0 || sectorBases.some((base) => base.value === bits.base);
  const mbf21 = atLeast(level, "mbf21") || bits.altDamage || bits.killGrounded;
  return (
    <>
      <div className="flex items-center items-end gap-2 [&>*]:min-w-0 [&>*]:flex-1">
        <ChoiceField
          label="Effect"
          value={String(bits.base)}
          items={[
            { value: "0", label: "None" },
            ...sectorBases.map(({ value, label }) => ({
              value: String(value),
              label,
            })),
            {
              value: String(exitSpecial),
              label: sectorEffects["damage-20-exit"].label,
            },
            ...(known || exit
              ? []
              : [{ value: String(bits.base), label: `Type ${bits.base}` }]),
          ]}
          // Boom ignores the exit type once any bit above it is set.
          onChange={(base) =>
            Number(base) === exitSpecial
              ? onChange(exitSpecial)
              : set({ base: Number(base) })
          }
        />
        <TagSetting value={tag} free={free} onChange={onTagChange} />
      </div>
      <div className="flex items-center items-end gap-2 [&>*]:min-w-0 [&>*]:flex-1">
        {exit ? null : (
          <ChoiceField
            label="Damage"
            value={String(bits.damage)}
            items={(bits.altDamage ? altDamageLabels : damageLabels).map(
              (label, value) => ({ value: String(value), label }),
            )}
            onChange={(damage) => set({ damage: Number(damage) })}
          />
        )}
        <NumberSetting
          label="Special number"
          value={special}
          step={1}
          min={0}
          max={rawSpecialLimit}
          onChange={onChange}
        />
      </div>
      {exit ? null : (
        <>
          <ToggleField
            label="Secret"
            checked={bits.secret}
            onChange={(secret) => set({ secret })}
          />
          <ToggleField
            label="Friction set by a line 223 with its tag"
            checked={bits.friction}
            onChange={(friction) => set({ friction })}
          />
          <ToggleField
            label="Wind or current from a line 224 to 226 with its tag"
            checked={bits.wind}
            onChange={(wind) => set({ wind })}
          />
          {mbf21 ? (
            <>
              <ToggleField
                label="Damage kills instead (MBF21)"
                checked={bits.altDamage}
                onChange={(altDamage) => set({ altDamage })}
              />
              <ToggleField
                label="Kills monsters on the floor (MBF21)"
                checked={bits.killGrounded}
                onChange={(killGrounded) => set({ killGrounded })}
              />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

interface DoorFieldsProps {
  door: DoorSettings;
  assets: SceneAssets;
  light: number;
  onChange: (door: DoorSettings) => void;
}

function DoorFields({ door, assets, light, onChange }: DoorFieldsProps) {
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

interface BoomLineFieldsProps {
  map: GameMap;
  special: number;
  tag: number;
  sides: LineSides;
  onChange: (special: number) => void;
  onTargetChange: (sector: string | null) => void;
}

// A Boom line special is one number with a field for each choice, so the
// fields edit it together.
function BoomLineFields({
  map,
  special,
  tag,
  sides,
  onChange,
  onTargetChange,
}: BoomLineFieldsProps) {
  const kind = generalizedKind(special);
  if (!kind) return null;
  const { trigger } = generalizedTrigger(special);
  const target = tag ? map.sectors.find((item) => item.tag === tag) : undefined;
  return (
    <>
      {generalizedFields(special).map((field) => {
        const value = fieldValue(special, field);
        if (field.width === 1 && field.options[0] === "No") {
          return (
            <ToggleField
              key={field.id}
              label={field.label}
              checked={value === 1}
              onChange={(checked) =>
                onChange(withField(special, field, checked ? 1 : 0))
              }
            />
          );
        }
        // Nothing walks over or presses the back of a wall with nothing
        // behind it, and a pressed door opens whatever is behind its line. A
        // trigger already set stays, once or repeating.
        const items = field.options.flatMap((label, option) =>
          field.id !== "trigger" ||
          option >> 1 === value >> 1 ||
          (option >= 2 && option <= 5) ||
          (option >= 6 && getIsDoorClass(kind)
            ? sides.doorBehind
            : sides.twoSided)
            ? [{ value: String(option), label }]
            : [],
        );
        return (
          <ChoiceField
            key={field.id}
            label={field.label}
            value={String(value)}
            items={items}
            onChange={(next) =>
              onChange(withField(special, field, Number(next)))
            }
          />
        );
      })}
      {trigger === "door" ? null : (
        <ChoiceField
          label={kind.target}
          value={target?.id ?? "none"}
          items={[
            { value: "none", label: "Choose a sector" },
            ...map.sectors.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
          onChange={(next) => onTargetChange(next === "none" ? null : next)}
        />
      )}
    </>
  );
}

const allSkills: ThingSkill[] = ["easy", "medium", "hard"];

const coordinateLimit = 32000;

const thingFlags: {
  flag: "multiplayer" | "notDeathmatch" | "notCoop" | "friendly";
  label: string;
  enemies?: boolean;
}[] = [
  { flag: "multiplayer", label: "Only in network games" },
  { flag: "notDeathmatch", label: "Not in deathmatch (Boom)" },
  { flag: "notCoop", label: "Not in co-op (Boom)" },
  { flag: "friendly", label: "Fights for the player (MBF)", enemies: true },
];

interface ThingFieldsProps {
  things: Thing[];
  grid: number;
  onChange: (change: ThingChange) => void;
}

function ThingFields({ things, grid, onChange }: ThingFieldsProps) {
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
  const kinds = swappableKinds(first.kind).filter((kind) =>
    things.every((thing) => swappableKinds(thing.kind).includes(kind)),
  );
  const sameKind = things.every((thing) => thing.kind === first.kind);
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
        {kinds.length > 0 ? (
          <ChoiceField
            label="Type"
            value={sameKind ? first.kind : mixed}
            items={[
              ...(sameKind ? [] : [{ value: mixed, label: mixed }]),
              ...kinds.map((kind) => ({
                value: kind,
                label: thingCatalog[kind].label,
              })),
            ]}
            onChange={(kind) => {
              if (kind !== mixed) onChange(() => ({ kind: kind as ThingKind }));
            }}
          />
        ) : null}
        <div className="flex gap-2.5">
          {single ? (
            <>
              <CompactNumber
                label="X"
                value={single.x}
                min={-coordinateLimit}
                max={coordinateLimit}
                step={grid}
                onChange={(x) => onChange(() => ({ x }))}
              />
              <CompactNumber
                label="Y"
                value={0 - single.y}
                min={-coordinateLimit}
                max={coordinateLimit}
                step={grid}
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
            variant="segmented"
            className="grid-cols-3"
            value={pressed}
            onValueChange={(next) => {
              const changed = allSkills.find(
                (skill) => next.includes(skill) !== pressed.includes(skill),
              );
              if (changed) toggleSkill(changed, next.includes(changed));
            }}
          >
            {allSkills.map((skill) => (
              <Toggle key={skill} value={skill} variant="segmented">
                {skillLabels[skill]}
              </Toggle>
            ))}
          </ToggleGroup>
          {enemies.length > 0 ? (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={enemies.every((thing) => thing.ambush)}
                onCheckedChange={(checked) =>
                  onChange((thing) =>
                    thingCatalog[thing.kind].category === "enemy"
                      ? { ambush: checked === true || undefined }
                      : {},
                  )
                }
              />
              Wait until player is seen
            </label>
          ) : null}
          {thingFlags
            .filter(({ enemies: only }) => !only || enemies.length > 0)
            .map(({ flag, label, enemies: only }) => {
              const applies = only ? enemies : placed;
              return (
                <label key={flag} className="flex items-center gap-2">
                  <Checkbox
                    checked={applies.every((thing) => thing[flag])}
                    onCheckedChange={(checked) =>
                      onChange((thing) =>
                        !only || thingCatalog[thing.kind].category === "enemy"
                          ? { [flag]: checked === true || undefined }
                          : {},
                      )
                    }
                  />
                  {label}
                </label>
              );
            })}
        </InspectorSection>
      ) : null}
    </>
  );
}

interface CompactNumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function CompactNumber({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: CompactNumberProps) {
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
        <NumberInputGroup className="flex h-8 items-center rounded-[3px] border border-input bg-input/30 px-2 shadow-xs has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring">
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

const thingTabs: { value: ThingTab; label: string }[] = [
  { value: "enemy", label: "Enemies" },
  { value: "item", label: "Items" },
  { value: "key", label: "Keys" },
  { value: "decor", label: "Decor" },
];

interface PlaceThingsProps {
  kind: ThingKind | null;
  kinds: readonly ThingKind[];
  onPick: (kind: ThingKind | null) => void;
}

function PlaceThings({ kind, kinds, onPick }: PlaceThingsProps) {
  const [tab, setTab] = React.useState(() => (kind ? tabOf(kind) : "enemy"));
  const [query, setQuery] = React.useState("");
  const shown = query.trim()
    ? rankByQuery(kinds, query, (item) => [
        thingCatalog[item].label,
        thingTabs.find((entry) => entry.value === tabOf(item))?.label ?? "",
      ])
    : kinds.filter((item) => tabOf(item) === tab);
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
                onClick={() => onPick(active ? null : item)}
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

function tabOf(kind: ThingKind): ThingTab {
  const { category } = thingCatalog[kind];
  return category === "start" ? "item" : category;
}

// Playtests launch the engine on skill 3.
const playtestSkill: ThingSkill = "medium";

interface BalancePanelProps {
  map: GameMap;
}

function BalancePanel({ map }: BalancePanelProps) {
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

interface MeterProps {
  label: string;
  value: number;
  fill: number;
  color: string;
}

function Meter({ label, value, fill, color }: MeterProps) {
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
