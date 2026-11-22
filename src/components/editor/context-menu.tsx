import { formatShortcut } from "@ui-sdk/core";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  type MenuController,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIcon,
  MenuItemIndicator,
  type MenuProps,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from "@ui-sdk/react/menu";
import {
  Box,
  Check,
  ChevronRight,
  ClipboardPaste,
  Compass,
  Copy,
  CopyPlus,
  Cuboid,
  DoorOpen,
  EyeOff,
  FlipHorizontal2,
  Grid3x3,
  Link,
  LocateFixed,
  type LucideIcon,
  Maximize,
  MousePointer2,
  Paintbrush,
  PenLine,
  Plus,
  Replace,
  RotateCw,
  Scissors,
  Shapes,
  Shield,
  Square,
  ToggleRight,
  Trash2,
  Unlink,
  Video,
  Zap,
} from "lucide-react";
import * as React from "react";

import type { Transform } from "@/lib/map/fragment";
import type { TextureKind } from "@/lib/map/texture-tools";
import type { GameMap, Point, Thing, ThingKind } from "@/lib/map/types";

import {
  getCanStand,
  type MapTarget,
  targetExists,
  viewOfTarget,
  wallMiddle,
} from "@/lib/editor/map-target";
import { type EditorShortcut, editorShortcuts } from "@/lib/editor/shortcuts";
import { thingIcons } from "@/lib/editor/thing-icons";
import { getIsGeneralized } from "@/lib/map/boom";
import { swappableKinds, thingCatalog } from "@/lib/map/catalog";
import {
  addRoomOnSide,
  addSwitch,
  addThing,
  changeThings,
  connectedCorners,
  defaultDoor,
  faceThings,
  fillHole,
  flipDetailLine,
  freeWallAt,
  makePillar,
  removeDetailLine,
  removeHole,
  removeSector,
  removeSwitch,
  removeThings,
  roomCenter,
  roomKeyPrefix,
  type RoomSide,
  setRoomDoor,
  setRoomWalls,
  snapCorners,
  splitWall,
  switchKeyPrefix,
  thingKeyPrefix,
  updateLine,
  updateSwitch,
  wallKeyPrefix,
} from "@/lib/map/edit";
import {
  containerOf,
  sectorAt,
  sectorVertices,
  wallOwners,
} from "@/lib/map/geometry";
import {
  describeLine,
  fitLineAction,
  getIsLineActionKind,
  lineActionGroups,
  lineActionKinds,
  newLineAction,
  triggersFor,
} from "@/lib/map/lines";
import { removeCorner } from "@/lib/map/reshape";
import {
  type RoomLikeness,
  similarRooms,
  similarThings,
  similarWalls,
  type WallLikeness,
} from "@/lib/map/similar";
import {
  describeSurface,
  paintSurface,
  parseSurface,
  surfaceKey,
  type WallPart,
} from "@/lib/map/surfaces";
import { alignWalls } from "@/lib/map/texture-tools";
import { validateMap } from "@/lib/map/validate";

import type { EditMode } from "./map-editor";

interface Selection {
  keys?: string[];
  sector?: string | null;
  // The wall the inspector shows, when the keys are walls.
  wall?: { sector: string; wall: string };
}

// Copy, paste and the transforms act on the whole selection, which the
// screen holds, so the menu only asks for them.
interface EditActions {
  canCopy: boolean;
  canTransform: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: (point: Point | null) => void;
  onDuplicate: () => void;
  onTransform: (transform: Transform) => void;
  onTransformBy: () => void;
  onPrefabs: (point: Point | null) => void;
  onCurve: (wall: string) => void;
  onFlip: (wall: string, sides: boolean) => void;
  onStairs: (room: string) => void;
}

// A wall's texture can be picked up and put on other walls, and a texture can
// be swapped for another across the whole map.
interface TextureActions {
  picked: string | null;
  widthOf: (texture: string) => number;
  onPick: (texture: string) => void;
  onReplace: (kind: TextureKind, from: string) => void;
}

interface MapContextMenuProps {
  controller: MenuController;
  map: GameMap;
  target: MapTarget | null;
  thingKind: ThingKind;
  edit: EditActions;
  textures: TextureActions;
  onOpenChange: MenuProps["onOpenChange"];
  onCommit: (map: GameMap, selection?: Selection) => void;
  onSelect: (selection: Selection) => void;
  onMoveCamera: (point: Point) => void;
  onShow: (target: MapTarget) => void;
  onFindCamera: () => void;
  onFitMap: () => void;
  onDrawRoom: (point: Point) => void;
  grid: number;
  editMode: EditMode;
}

type BodyProps = Omit<MapContextMenuProps, "controller" | "onOpenChange">;

const contentClass =
  "z-30 w-54 rounded-md border border-border bg-popover p-1 shadow-popover outline-none";
const itemClass =
  "flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-[disabled]:text-muted-foreground/60 data-[highlighted]:bg-accent data-[popup-open]:bg-accent";
const iconClass = "flex w-3.5 shrink-0 justify-center text-muted-foreground";

export function MapContextMenu({
  controller,
  onOpenChange,
  target,
  ...props
}: MapContextMenuProps) {
  return (
    <Menu controller={controller} onOpenChange={onOpenChange}>
      <MenuContent className={contentClass} align="start">
        {target && targetExists(props.map, target) ? (
          <MenuBody {...props} target={target} />
        ) : null}
      </MenuContent>
    </Menu>
  );
}

interface MenuBodyProps extends BodyProps {
  target: MapTarget;
}

function MenuBody({ target, ...props }: MenuBodyProps) {
  const shared = { ...props, target };
  if (target.kind === "things")
    return <ThingsMenu {...shared} ids={target.ids} />;
  if (target.kind === "corners") {
    return <CornersMenu {...shared} ids={target.ids} />;
  }
  if (target.kind === "room")
    return <RoomMenu {...shared} id={target.sector} />;
  if (target.kind === "switch")
    return <SwitchMenu {...shared} id={target.id} />;
  if (target.kind === "wall") {
    return <WallMenu {...shared} sector={target.sector} wall={target.wall} />;
  }
  if (target.kind === "hole") {
    return <HoleMenu {...shared} sector={target.sector} index={target.index} />;
  }
  return <EmptyMenu {...shared} />;
}

const facings = [
  { angle: 0, label: "East" },
  { angle: 45, label: "Northeast" },
  { angle: 90, label: "North" },
  { angle: 135, label: "Northwest" },
  { angle: 180, label: "West" },
  { angle: 225, label: "Southwest" },
  { angle: 270, label: "South" },
  { angle: 315, label: "Southeast" },
];

interface ThingsMenuProps extends BodyProps {
  ids: string[];
  target: MapTarget;
}

function ThingsMenu({ ids, ...props }: ThingsMenuProps) {
  const { map, onCommit } = props;
  const things = ids.flatMap(
    (id) => map.things.find((item) => item.id === id) ?? [],
  );
  const first: Thing | undefined = things[0];
  if (!first) return null;
  const single = things.length === 1;
  const kinds = swappableKinds(first.kind).filter((kind) =>
    things.every((thing) => swappableKinds(thing.kind).includes(kind)),
  );
  const number = map.things.indexOf(first) + 1;
  const sameKind = things.every((thing) => thing.kind === first.kind);
  const sameAngle = things.every((thing) => thing.angle === first.angle);
  return (
    <>
      <Heading>
        {single
          ? `${thingCatalog[first.kind].label} · Thing ${String(number).padStart(2, "0")}`
          : `${things.length} things`}
      </Heading>
      <SubMenu icon={Replace} label="Change type" disabled={kinds.length === 0}>
        <Choices
          value={sameKind ? first.kind : null}
          items={kinds.map((kind) => ({
            value: kind,
            label: thingCatalog[kind].label,
            ...thingIcons[kind],
          }))}
          onChange={(kind) =>
            onCommit(changeThings(map, ids, kind as ThingKind))
          }
        />
      </SubMenu>
      <SubMenu icon={Compass} label="Face">
        <Choices
          value={sameAngle ? String(first.angle) : null}
          items={facings.map(({ angle, label }) => ({
            value: String(angle),
            label,
          }))}
          onChange={(angle) => onCommit(faceThings(map, ids, Number(angle)))}
        />
      </SubMenu>
      <Item
        icon={MousePointer2}
        onSelect={() =>
          props.onSelect({
            keys: similarThings(map, ids).map((id) => `${thingKeyPrefix}${id}`),
            sector: null,
          })
        }
      >
        {sameKind ? "Select all of this type" : "Select all of these types"}
      </Item>
      <Rule />
      {single ? (
        <>
          <ShowItem {...props} />
          <CameraItem {...props} point={{ x: first.x, y: first.y }} />
          <Rule />
        </>
      ) : null}
      <EditItems edit={props.edit} point={{ x: first.x, y: first.y }} />
      <Rule />
      <Item
        icon={Trash2}
        hint="⌫"
        destructive
        onSelect={() =>
          onCommit(removeThings(map, ids), { keys: [], sector: null })
        }
      >
        {single ? "Delete" : `Delete ${things.length} things`}
      </Item>
    </>
  );
}

interface HeadingProps {
  children: React.ReactNode;
}

function Heading({ children }: HeadingProps) {
  return (
    <div className="truncate px-2 pt-1 pb-1.5 font-mono text-xs tracking-[0.04em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

interface SubMenuProps {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function SubMenu({ icon: Icon, label, disabled, children }: SubMenuProps) {
  return (
    <MenuSub>
      <MenuSubTrigger className={itemClass} disabled={disabled}>
        <MenuItemIcon className={iconClass}>
          <Icon size={14} />
        </MenuItemIcon>
        {label}
        <MenuItemIcon className="ml-auto text-muted-foreground" mirror>
          <ChevronRight size={14} />
        </MenuItemIcon>
      </MenuSubTrigger>
      <MenuSubContent
        className={`${contentClass} max-h-(--available-height) w-max max-w-72 min-w-44 overflow-y-auto`}
        sideOffset={4}
      >
        {children}
      </MenuSubContent>
    </MenuSub>
  );
}

interface ChoicesProps {
  value: string | null;
  items: {
    value: string;
    label: string;
    disabled?: boolean;
    icon?: LucideIcon;
    color?: string;
  }[];
  onChange: (value: string) => void;
}

function Choices({ value, items, onChange }: ChoicesProps) {
  return (
    <MenuRadioGroup value={value} onValueChange={onChange}>
      {items.map((item) => (
        <MenuRadioItem
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          closeOnSelect
          className={itemClass}
        >
          {item.icon ? (
            <MenuItemIcon
              className="flex w-3.5 shrink-0 justify-center"
              style={{ color: item.color }}
            >
              <item.icon size={14} />
            </MenuItemIcon>
          ) : null}
          {item.label}
          <MenuItemIndicator className="ml-auto text-primary">
            <Check size={14} />
          </MenuItemIndicator>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}

function Rule() {
  return <MenuSeparator className="-mx-1 my-1 h-px bg-border" />;
}

interface ShowItemProps extends BodyProps {
  target: MapTarget;
}

function ShowItem({ map, target, onShow }: ShowItemProps) {
  return (
    <Item
      icon={Box}
      disabled={!viewOfTarget(map, target)}
      onSelect={() => onShow(target)}
    >
      Show in 3D
    </Item>
  );
}

const hintClass = "ml-auto font-mono text-xs text-muted-foreground";
const destructiveHintClass = "ml-auto font-mono text-xs text-destructive";

const destructiveIconClass =
  "flex w-3.5 shrink-0 justify-center text-destructive";

interface ItemProps {
  icon: LucideIcon;
  hint?: string;
  children: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}

function Item({
  icon: Icon,
  hint,
  children,
  destructive,
  ...props
}: ItemProps) {
  return (
    <MenuItem
      className={`${itemClass} data-[destructive]:text-destructive data-[destructive]:data-[highlighted]:bg-destructive/15`}
      destructive={destructive}
      {...props}
    >
      <MenuItemIcon className={destructive ? destructiveIconClass : iconClass}>
        <Icon size={14} />
      </MenuItemIcon>
      {children}
      {hint ? (
        <span className={destructive ? destructiveHintClass : hintClass}>
          {hint}
        </span>
      ) : null}
    </MenuItem>
  );
}

interface EditItemsProps {
  edit: EditActions;
  point: Point | null;
}

function EditItems({ edit, point }: EditItemsProps) {
  return (
    <>
      <Item
        icon={Scissors}
        hint={formatShortcut("mod+x")}
        disabled={!edit.canCopy}
        onSelect={edit.onCut}
      >
        Cut
      </Item>
      <Item
        icon={Copy}
        hint={formatShortcut("mod+c")}
        disabled={!edit.canCopy}
        onSelect={edit.onCopy}
      >
        Copy
      </Item>
      <PasteItem edit={edit} point={point} />
      <Item
        icon={CopyPlus}
        hint={formatShortcut(editorShortcuts.duplicate.keys)}
        disabled={!edit.canCopy}
        onSelect={edit.onDuplicate}
      >
        Duplicate
      </Item>
      <TransformMenu edit={edit} />
      <PrefabsItem edit={edit} point={point} />
    </>
  );
}

function PrefabsItem({ edit, point }: EditItemsProps) {
  return (
    <Item icon={Shapes} onSelect={() => edit.onPrefabs(point)}>
      Prefabs…
    </Item>
  );
}

function PasteItem({ edit, point }: EditItemsProps) {
  return (
    <Item
      icon={ClipboardPaste}
      hint={formatShortcut("mod+v")}
      onSelect={() => edit.onPaste(point)}
    >
      Paste here
    </Item>
  );
}

interface TransformMenuProps {
  edit: EditActions;
}

const transforms: {
  label: string;
  shortcut?: EditorShortcut;
  transform: Transform;
}[] = [
  {
    label: "Turn a quarter right",
    shortcut: "rotateRight",
    transform: { kind: "rotate", degrees: 90 },
  },
  {
    label: "Turn a quarter left",
    shortcut: "rotateLeft",
    transform: { kind: "rotate", degrees: -90 },
  },
  {
    label: "Flip left to right",
    shortcut: "flipAcross",
    transform: { kind: "mirror", axis: "horizontal" },
  },
  {
    label: "Flip top to bottom",
    shortcut: "flipOver",
    transform: { kind: "mirror", axis: "vertical" },
  },
  { label: "Double the size", transform: { kind: "scale", factor: 2 } },
  { label: "Halve the size", transform: { kind: "scale", factor: 0.5 } },
];

function TransformMenu({ edit }: TransformMenuProps) {
  return (
    <SubMenu icon={RotateCw} label="Transform" disabled={!edit.canTransform}>
      {transforms.map(({ label, shortcut, transform }) => (
        <MenuItem
          key={label}
          className={itemClass}
          onSelect={() => edit.onTransform(transform)}
        >
          {label}
          {shortcut ? (
            <span className={hintClass}>
              {formatShortcut(editorShortcuts[shortcut].keys)}
            </span>
          ) : null}
        </MenuItem>
      ))}
      <Rule />
      <MenuItem className={itemClass} onSelect={edit.onTransformBy}>
        Turn or resize by…
      </MenuItem>
    </SubMenu>
  );
}

interface CameraItemProps extends BodyProps {
  point: Point | null;
}

function CameraItem({ map, point, onMoveCamera }: CameraItemProps) {
  return (
    <Item
      icon={Video}
      hint="C"
      disabled={!getCanStand(map, point)}
      onSelect={() => point && onMoveCamera(point)}
    >
      Move camera here
    </Item>
  );
}

interface CornersMenuProps extends BodyProps {
  ids: string[];
  target: MapTarget;
}

function CornersMenu({ ids, ...props }: CornersMenuProps) {
  const { map, target, onCommit, onSelect, grid } = props;
  const corners = ids.flatMap((id) => map.vertices[id] ?? []);
  if (corners.length === 0) return null;
  const walls = [...wallOwners(map).keys()].filter((wall) =>
    wall.split("|").includes(ids[0]),
  ).length;
  const snapped = corners.every(({ x, y }) => x % grid === 0 && y % grid === 0);
  const removed = ids.reduce(
    (current, id) => removeCorner(current, id) ?? current,
    map,
  );
  return (
    <>
      <Heading>
        {corners.length === 1
          ? `Corner · ${walls} ${walls === 1 ? "wall" : "walls"}`
          : `${corners.length} corners`}
      </Heading>
      <Item
        icon={Grid3x3}
        disabled={snapped}
        onSelect={() => onCommit(snapCorners(map, ids, grid))}
      >
        Snap to grid
      </Item>
      <Item
        icon={MousePointer2}
        onSelect={() =>
          onSelect({ keys: connectedCorners(map, ids), sector: null })
        }
      >
        Select connected rooms
      </Item>
      <Item
        icon={Trash2}
        disabled={removed === map}
        onSelect={() => onCommit(removed, { keys: [], sector: null })}
      >
        {corners.length === 1 ? "Delete corner" : "Delete corners"}
      </Item>
      <TransformMenu edit={props.edit} />
      <Rule />
      <CameraItem {...props} point={target.point ?? corners[0]} />
    </>
  );
}

const roomSides: { side: RoomSide; label: string }[] = [
  { side: "north", label: "North" },
  { side: "east", label: "East" },
  { side: "south", label: "South" },
  { side: "west", label: "West" },
];

const roomLikeness: { by: RoomLikeness; label: string }[] = [
  { by: "floorTexture", label: "Same floor texture" },
  { by: "floor", label: "Same floor height" },
  { by: "light", label: "Same light" },
  { by: "tag", label: "Same tag" },
];

interface RoomMenuProps extends BodyProps {
  id: string;
  target: MapTarget;
}

function RoomMenu({ id, ...props }: RoomMenuProps) {
  const { map, target, onCommit } = props;
  const room = map.sectors.find((sector) => sector.id === id);
  if (!room) return null;
  const point = target.point ?? roomCenter(map, room);
  const copied = {
    floor: room.floor,
    ceiling: room.ceiling,
    light: room.light,
    floorTexture: room.floorTexture,
    ceilingTexture: room.ceilingTexture,
    wallTexture: room.wallTexture,
  };
  const added = (side: RoomSide) => {
    const next = addRoomOnSide(map, room.id, side, 192, copied);
    return next && addsNoProblems(map, next.map) ? next : null;
  };
  const holdsPlayer = map.things.some(
    (thing) => thing.kind === "player" && sectorAt(map, thing) === room,
  );
  const container = containerOf(map, room);
  const holdsThing = map.things.some((thing) => sectorAt(map, thing) === room);
  const { picked } = props.textures;
  const pillar = holdsThing ? null : makePillar(map, room.id);
  return (
    <>
      <Heading>
        {room.name} · {room.door ? "Door" : "Room"}
      </Heading>
      <SubMenu icon={Plus} label="Add room">
        {roomSides.map(({ side, label }) => {
          const next = added(side);
          return (
            <MenuItem
              key={side}
              className={itemClass}
              disabled={!next}
              onSelect={() =>
                next && onCommit(next.map, { keys: [], sector: next.id })
              }
            >
              {label}
            </MenuItem>
          );
        })}
      </SubMenu>
      <PlaceItem {...props} point={point} />
      <Item
        icon={DoorOpen}
        disabled={!room.door && holdsPlayer}
        onSelect={() =>
          onCommit(
            setRoomDoor(map, room.id, room.door ? undefined : defaultDoor),
          )
        }
      >
        {room.door ? "Make room" : "Make door"}
      </Item>
      <Item
        icon={Cuboid}
        disabled={!pillar}
        onSelect={() =>
          pillar &&
          onCommit(pillar, { keys: [], sector: container?.id ?? null })
        }
      >
        Make pillar
      </Item>
      <Item
        icon={Shapes}
        disabled={Boolean(room.door)}
        onSelect={() => props.edit.onStairs(room.id)}
      >
        Build stairs…
      </Item>
      <SubMenu icon={Paintbrush} label="Texture">
        <MenuItem
          className={itemClass}
          disabled={!picked || Boolean(room.door)}
          onSelect={() =>
            picked && onCommit(setRoomWalls(map, room.id, picked))
          }
        >
          {picked
            ? `Apply ${picked} to every wall`
            : "Apply the picked texture"}
        </MenuItem>
        <Rule />
        {(
          [
            ["wall", "walls'", room.wallTexture],
            ["flat", "floor's", room.floorTexture],
            ["flat", "ceiling's", room.ceilingTexture],
          ] as const
        ).map(([kind, whose, texture]) => (
          <MenuItem
            key={whose}
            className={itemClass}
            onSelect={() => props.textures.onReplace(kind, texture)}
          >
            Replace the {whose} {texture} everywhere…
          </MenuItem>
        ))}
      </SubMenu>
      <SubMenu icon={MousePointer2} label="Select similar">
        {roomLikeness.map(({ by, label }) => (
          <MenuItem
            key={by}
            className={itemClass}
            disabled={by === "tag" && !room.tag}
            onSelect={() => {
              const ids = similarRooms(map, room.id, by);
              if (ids.length === 1) {
                props.onSelect({ keys: [], sector: ids[0] });
                return;
              }
              const picked = new Set(ids);
              props.onSelect({
                // Corner mode picks rooms by their corners, so its handles
                // show them.
                keys:
                  props.editMode === "sectors"
                    ? ids.map((id) => `${roomKeyPrefix}${id}`)
                    : [
                        ...new Set(
                          map.sectors
                            .filter((sector) => picked.has(sector.id))
                            .flatMap(sectorVertices),
                        ),
                      ],
                sector: null,
              });
            }}
          >
            {label}
          </MenuItem>
        ))}
      </SubMenu>
      <Rule />
      <EditItems edit={props.edit} point={point} />
      <Rule />
      <ShowItem {...props} />
      <CameraItem {...props} point={point} />
      <Rule />
      <Item
        icon={Trash2}
        hint="⌫"
        destructive
        onSelect={() =>
          onCommit(removeSector(map, room.id), { keys: [], sector: null })
        }
      >
        {room.door ? "Delete door" : "Delete room"}
      </Item>
    </>
  );
}

function addsNoProblems(map: GameMap, next: GameMap) {
  const known = new Set(validateMap(map).map((issue) => issue.id));
  return validateMap(next).every((issue) => known.has(issue.id));
}

interface PlaceItemProps extends BodyProps {
  point: Point | null;
}

function PlaceItem({ map, point, thingKind, onCommit }: PlaceItemProps) {
  return (
    <Item
      icon={thingIcons[thingKind].icon}
      disabled={!getCanStand(map, point)}
      onSelect={() => {
        if (!point) return;
        const placed = addThing(map, thingKind, point, 0, 1);
        onCommit(placed.map, {
          keys: [`${thingKeyPrefix}${placed.id}`],
          sector: null,
        });
      }}
    >
      Place {thingCatalog[thingKind].label} here
    </Item>
  );
}

interface SwitchMenuProps extends BodyProps {
  id: string;
  target: MapTarget;
}

function SwitchMenu({ id, ...props }: SwitchMenuProps) {
  const { map, onCommit } = props;
  const item = map.switches.find((entry) => entry.id === id);
  if (!item) return null;
  const room = map.sectors.find((sector) => sector.id === item.sector);
  const doors = map.sectors.filter((sector) => sector.door);
  return (
    <>
      <Heading>Switch · {room?.name}</Heading>
      <SubMenu icon={Link} label="Connect to door" disabled={!doors.length}>
        <Choices
          value={item.door}
          items={doors.map((door) => ({ value: door.id, label: door.name }))}
          onChange={(door) => onCommit(updateSwitch(map, id, { door }))}
        />
      </SubMenu>
      <Item
        icon={Unlink}
        disabled={!item.door}
        onSelect={() => onCommit(updateSwitch(map, id, { door: null }))}
      >
        Disconnect
      </Item>
      <Rule />
      <ShowItem {...props} />
      <Rule />
      <Item
        icon={Trash2}
        hint="⌫"
        destructive
        onSelect={() =>
          onCommit(removeSwitch(map, id), { keys: [], sector: null })
        }
      >
        Delete switch
      </Item>
    </>
  );
}

const wallLikeness: { by: WallLikeness; label: string }[] = [
  { by: "texture", label: "Same texture" },
  { by: "action", label: "Same action" },
];

interface WallMenuProps extends BodyProps {
  sector: string;
  wall: string;
  target: MapTarget;
}

function WallMenu({ sector, wall, ...props }: WallMenuProps) {
  const { map, target, onCommit, grid } = props;
  const line = describeLine(map, wall, sector);
  const { action, blocksEnemies, hidden, raw } = line.settings;
  const free = freeWallAt(map, wall);
  const detail =
    (wallOwners(map).get(wall) ?? []).filter((item) => item.id === sector)
      .length > 1;
  const corner = splitWall(
    map,
    wall,
    target.point ?? wallMiddle(map, wall),
    grid,
  );
  const middle = splitWall(map, wall, wallMiddle(map, wall), 1);
  // The parts of this side that show a wall texture. The map doesn't say
  // which part of an open wall was pressed, so there it is every part the
  // rooms' heights leave showing.
  const pressed = target.surface ? parseSurface(target.surface) : null;
  const part = pressed?.kind === "wall" ? pressed.part : "middle";
  const beyond = [line.front, line.back].find(
    (item) => item && item !== line.sector,
  );
  const parts: WallPart[] =
    part !== "middle" || !beyond || detail
      ? [part]
      : [
          ...(beyond.floor > line.sector.floor ? (["lower"] as const) : []),
          ...(beyond.ceiling < line.sector.ceiling ? (["upper"] as const) : []),
        ];
  const surfaces = parts
    .map((item) => surfaceKey({ kind: "wall", sector, wall, part: item }))
    .filter((key) => describeSurface(map, key)?.paints === "wall");
  const texture = surfaces[0]
    ? (describeSurface(map, surfaces[0])?.texture ?? null)
    : null;
  const { picked } = props.textures;
  const aligned = alignWalls(map, sector, wall, props.textures.widthOf);
  const chooseAction = (kind: string) => {
    if (!getIsLineActionKind(kind)) {
      onCommit(
        updateLine(map, wall, {
          action: undefined,
          raw: raw && getIsGeneralized(raw.special) ? undefined : raw,
        }),
      );
      return;
    }
    onCommit(
      updateLine(map, wall, {
        action: action
          ? fitLineAction({ ...action, kind }, line)
          : newLineAction(line, kind),
        scrolls: undefined,
        raw: undefined,
        shut: undefined,
      }),
    );
  };

  return (
    <>
      <Heading>
        {detail ? "Line" : "Wall"} · {line.sector.name}
      </Heading>
      <Item
        icon={ToggleRight}
        disabled={!free}
        onSelect={() => {
          if (!free) return;
          const added = addSwitch(
            map,
            free,
            target.point ?? wallMiddle(map, wall),
            null,
            grid,
          );
          onCommit(added.map, {
            keys: [`${switchKeyPrefix}${added.id}`],
            sector: null,
          });
        }}
      >
        Add switch
      </Item>
      <Item
        icon={Plus}
        disabled={!corner}
        onSelect={() =>
          corner && onCommit(corner.map, { keys: [corner.id], sector: null })
        }
      >
        Add corner here
      </Item>
      <Item
        icon={Plus}
        disabled={!middle}
        onSelect={() =>
          middle && onCommit(middle.map, { keys: [middle.id], sector: null })
        }
      >
        Split in the middle
      </Item>
      <Item icon={Shapes} onSelect={() => props.edit.onCurve(wall)}>
        Curve…
      </Item>
      {line.back && !detail && !line.front.door && !line.back.door ? (
        <>
          <Item
            icon={FlipHorizontal2}
            hint={formatShortcut(editorShortcuts.flipWalls.keys)}
            onSelect={() => props.edit.onFlip(wall, false)}
          >
            Flip line
          </Item>
          <Item
            icon={FlipHorizontal2}
            hint={formatShortcut(editorShortcuts.swapSides.keys)}
            onSelect={() => props.edit.onFlip(wall, true)}
          >
            Swap sides' textures
          </Item>
        </>
      ) : null}
      <SubMenu icon={Zap} label="Action" disabled={line.wiredSwitch}>
        <Choices
          value={action?.kind ?? "none"}
          items={[{ value: "none", label: "Nothing" }]}
          onChange={chooseAction}
        />
        {lineActionGroups(
          lineActionKinds.filter(
            (value) =>
              value === action?.kind || triggersFor(value, line).length > 0,
          ),
        ).map((group) => (
          <MenuGroup key={group.label}>
            <MenuGroupLabel className="px-2 pt-2 pb-1 font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {group.label}
            </MenuGroupLabel>
            <Choices
              value={action?.kind ?? "none"}
              items={group.items.map((item) => ({
                value: item.value,
                label: item.short,
              }))}
              onChange={chooseAction}
            />
          </MenuGroup>
        ))}
      </SubMenu>
      <Rule />
      <CheckItem
        icon={Shield}
        checked={Boolean(blocksEnemies)}
        onChange={(checked) =>
          onCommit(
            updateLine(map, wall, { blocksEnemies: checked || undefined }),
          )
        }
      >
        Blocks enemies
      </CheckItem>
      <CheckItem
        icon={EyeOff}
        checked={Boolean(hidden)}
        onChange={(checked) =>
          onCommit(updateLine(map, wall, { hidden: checked || undefined }))
        }
      >
        Hide on automap
      </CheckItem>
      {detail ? null : (
        <SubMenu
          icon={Paintbrush}
          label="Texture"
          disabled={!texture && aligned === map}
        >
          <MenuItem
            className={itemClass}
            disabled={aligned === map}
            onSelect={() => onCommit(aligned)}
          >
            Align along the room
          </MenuItem>
          <MenuItem
            className={itemClass}
            disabled={!texture}
            onSelect={() => texture && props.textures.onPick(texture)}
          >
            {texture ? `Pick up ${texture}` : "Pick up the texture"}
          </MenuItem>
          <MenuItem
            className={itemClass}
            disabled={
              !picked ||
              surfaces.every(
                (key) => describeSurface(map, key)?.texture === picked,
              )
            }
            onSelect={() =>
              picked &&
              onCommit(
                surfaces.reduce(
                  (next, key) => paintSurface(next, key, picked),
                  map,
                ),
              )
            }
          >
            {picked ? `Apply ${picked}` : "Apply the picked texture"}
          </MenuItem>
          <Rule />
          <MenuItem
            className={itemClass}
            disabled={!texture}
            onSelect={() =>
              texture && props.textures.onReplace("wall", texture)
            }
          >
            {texture
              ? `Replace ${texture} everywhere…`
              : "Replace the texture everywhere…"}
          </MenuItem>
        </SubMenu>
      )}
      <SubMenu icon={MousePointer2} label="Select similar">
        {wallLikeness.map(({ by, label }) => (
          <MenuItem
            key={by}
            className={itemClass}
            disabled={by === "action" && !action && !raw && !line.wiredSwitch}
            onSelect={() =>
              props.onSelect({
                keys: similarWalls(map, wall, sector, by).map(
                  (item) => `${wallKeyPrefix}${item}`,
                ),
                sector: null,
                wall: { sector, wall },
              })
            }
          >
            {label}
          </MenuItem>
        ))}
      </SubMenu>
      <Rule />
      <ShowItem {...props} />
      {detail ? (
        <>
          <Rule />
          <Item
            icon={FlipHorizontal2}
            onSelect={() => onCommit(flipDetailLine(map, sector, wall))}
          >
            Flip line
          </Item>
          <Item
            icon={Trash2}
            destructive
            onSelect={() =>
              onCommit(removeDetailLine(map, sector, wall), {
                keys: [],
                sector: null,
              })
            }
          >
            Delete line
          </Item>
        </>
      ) : null}
    </>
  );
}

interface CheckItemProps {
  icon: LucideIcon;
  checked: boolean;
  children: string;
  onChange: (checked: boolean) => void;
}

function CheckItem({
  icon: Icon,
  checked,
  children,
  onChange,
}: CheckItemProps) {
  return (
    <MenuCheckboxItem
      value={children}
      className={itemClass}
      checked={checked}
      closeOnSelect
      onCheckedChange={onChange}
    >
      <MenuItemIcon className={iconClass}>
        <Icon size={14} />
      </MenuItemIcon>
      {children}
      <MenuItemIndicator className="ml-auto text-primary">
        <Check size={14} />
      </MenuItemIndicator>
    </MenuCheckboxItem>
  );
}

interface HoleMenuProps extends BodyProps {
  sector: string;
  index: number;
  target: MapTarget;
}

function HoleMenu({ sector, index, ...props }: HoleMenuProps) {
  const { map, onCommit } = props;
  const room = map.sectors.find((item) => item.id === sector);
  if (!room) return null;
  return (
    <>
      <Heading>Pillar · {room.name}</Heading>
      <Item
        icon={Square}
        onSelect={() => {
          const filled = fillHole(map, sector, index);
          if (filled) onCommit(filled.map, { keys: [], sector: filled.id });
        }}
      >
        Make room
      </Item>
      <Rule />
      <ShowItem {...props} />
      <Rule />
      <Item
        icon={Trash2}
        destructive
        onSelect={() =>
          onCommit(removeHole(map, sector, index), { keys: [], sector })
        }
      >
        Delete pillar
      </Item>
    </>
  );
}

interface EmptyMenuProps extends BodyProps {
  target: MapTarget;
}

function EmptyMenu(props: EmptyMenuProps) {
  const { target, onDrawRoom, onFindCamera, onFitMap } = props;
  const { point } = target;
  return (
    <>
      <Heading>Empty map</Heading>
      <Item
        icon={PenLine}
        disabled={!point}
        onSelect={() => point && onDrawRoom(point)}
      >
        Draw room here
      </Item>
      <PlaceItem {...props} point={point} />
      <PasteItem edit={props.edit} point={point} />
      <PrefabsItem edit={props.edit} point={point} />
      <Rule />
      <CameraItem {...props} point={point} />
      <Item icon={LocateFixed} onSelect={onFindCamera}>
        Find camera
      </Item>
      <Item icon={Maximize} onSelect={onFitMap}>
        Fit map
      </Item>
    </>
  );
}
