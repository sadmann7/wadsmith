import { formatShortcut } from "@ui-sdk/core";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIcon,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  type MenuController,
  type MenuProps,
} from "@ui-sdk/react/menu";
import {
  Box,
  Check,
  ChevronRight,
  Compass,
  Copy,
  Cuboid,
  DoorOpen,
  FlipHorizontal2,
  EyeOff,
  Grid3x3,
  Link,
  LocateFixed,
  Maximize,
  MousePointer2,
  PenLine,
  Plus,
  Replace,
  Shield,
  Square,
  ToggleRight,
  Trash2,
  Unlink,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { isPlayerStart, thingCatalog, thingKinds } from "@/map/catalog";
import {
  addRoomOnSide,
  addSwitch,
  addThing,
  changeThings,
  connectedCorners,
  defaultDoor,
  duplicateThings,
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
  setRoomDoor,
  snapCorners,
  splitWall,
  switchKeyPrefix,
  thingKeyPrefix,
  updateLine,
  updateSwitch,
  type RoomSide,
} from "@/map/edit";
import { containerOf, sectorAt, wallOwners } from "@/map/geometry";
import {
  describeLine,
  fitLineAction,
  isLineActionKind,
  lineActionGroups,
  lineActionKinds,
  newLineAction,
  triggersFor,
} from "@/map/lines";
import { isGeneralized } from "@/map/boom";
import type { GameMap, Point, Thing, ThingKind } from "@/map/types";
import { validateMap } from "@/map/validate";
import {
  canStand,
  targetExists,
  viewOfTarget,
  wallMiddle,
  type MapTarget,
} from "./map-target";
import { thingIcons } from "./thing-icons";

interface Selection {
  keys?: string[];
  sector?: string | null;
}

interface MapContextMenuProps {
  controller: MenuController;
  map: GameMap;
  target: MapTarget | null;
  thingKind: ThingKind;
  onOpenChange: MenuProps["onOpenChange"];
  onCommit: (map: GameMap, selection?: Selection) => void;
  onSelect: (selection: Selection) => void;
  onMoveCamera: (point: Point) => void;
  onShow: (target: MapTarget) => void;
  onFindCamera: () => void;
  onFitMap: () => void;
  onDrawRoom: (point: Point) => void;
  grid: number;
}

type BodyProps = Omit<MapContextMenuProps, "controller" | "onOpenChange">;

const contentClass =
  "z-30 w-54 rounded-md border border-border bg-popover p-1 shadow-popover outline-none";
const itemClass =
  "flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-[disabled]:text-muted-foreground/60 data-[highlighted]:bg-accent data-[popup-open]:bg-accent";
const iconClass = "flex w-3.5 shrink-0 justify-center text-muted-foreground";
const destructiveIconClass =
  "flex w-3.5 shrink-0 justify-center text-destructive";
const hintClass = "ml-auto font-mono text-xs text-muted-foreground";
const destructiveHintClass = "ml-auto font-mono text-xs text-destructive";

const roomSides: { side: RoomSide; label: string }[] = [
  { side: "north", label: "North" },
  { side: "east", label: "East" },
  { side: "south", label: "South" },
  { side: "west", label: "West" },
];

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

function swappableKinds(kind: ThingKind) {
  const { category } = thingCatalog[kind];
  return category === "start"
    ? []
    : thingKinds.filter((item) => thingCatalog[item].category === category);
}

function addsNoProblems(map: GameMap, next: GameMap) {
  const known = new Set(validateMap(map).map((issue) => issue.id));
  return validateMap(next).every((issue) => known.has(issue.id));
}

function Item({
  icon: Icon,
  hint,
  children,
  destructive,
  ...props
}: {
  icon: LucideIcon;
  hint?: string;
  children: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}) {
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

function CheckItem({
  icon: Icon,
  checked,
  children,
  onChange,
}: {
  icon: LucideIcon;
  checked: boolean;
  children: React.ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MenuCheckboxItem
      value={String(children)}
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

function SubMenu({
  icon: Icon,
  label,
  disabled,
  children,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
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

function Choices({
  value,
  items,
  onChange,
}: {
  value: string | null;
  items: {
    value: string;
    label: string;
    disabled?: boolean;
    icon?: LucideIcon;
    color?: string;
  }[];
  onChange: (value: string) => void;
}) {
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

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="truncate px-2 pt-1 pb-1.5 font-mono text-xs tracking-[0.04em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function Rule() {
  return <MenuSeparator className="-mx-1 my-1 h-px bg-border" />;
}

function ShowItem({ map, target, onShow }: BodyProps & { target: MapTarget }) {
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

function CameraItem({
  map,
  point,
  onMoveCamera,
}: BodyProps & { point: Point | null }) {
  return (
    <Item
      icon={Video}
      hint="C"
      disabled={!canStand(map, point)}
      onSelect={() => point && onMoveCamera(point)}
    >
      Move camera here
    </Item>
  );
}

function PlaceItem({
  map,
  point,
  thingKind,
  onCommit,
}: BodyProps & { point: Point | null }) {
  return (
    <Item
      icon={thingIcons[thingKind].icon}
      disabled={!canStand(map, point)}
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

function ThingsMenu({
  ids,
  ...props
}: BodyProps & { ids: string[]; target: MapTarget }) {
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
      <Rule />
      {single ? (
        <>
          <ShowItem {...props} />
          <CameraItem {...props} point={{ x: first.x, y: first.y }} />
          <Rule />
        </>
      ) : null}
      <Item
        icon={Copy}
        hint={formatShortcut("mod+d")}
        disabled={things.every((thing) => isPlayerStart(thing.kind))}
        onSelect={() => {
          const copies = duplicateThings(map, ids);
          onCommit(copies.map, {
            keys: copies.ids.map((id) => `${thingKeyPrefix}${id}`),
            sector: null,
          });
        }}
      >
        Duplicate
      </Item>
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

function RoomMenu({
  id,
  ...props
}: BodyProps & { id: string; target: MapTarget }) {
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

function HoleMenu({
  sector,
  index,
  ...props
}: BodyProps & { sector: string; index: number; target: MapTarget }) {
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

function WallMenu({
  sector,
  wall,
  ...props
}: BodyProps & { sector: string; wall: string; target: MapTarget }) {
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
  const chooseAction = (kind: string) => {
    if (!isLineActionKind(kind)) {
      onCommit(
        updateLine(map, wall, {
          action: undefined,
          raw: raw && isGeneralized(raw.special) ? undefined : raw,
        }),
      );
      return;
    }
    onCommit(
      updateLine(map, wall, {
        action: action
          ? fitLineAction({ ...action, kind }, line.twoSided)
          : newLineAction(line.twoSided, kind),
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
      <SubMenu icon={Zap} label="Action" disabled={line.wiredSwitch}>
        <Choices
          value={action?.kind ?? "none"}
          items={[{ value: "none", label: "Nothing" }]}
          onChange={chooseAction}
        />
        {lineActionGroups(
          lineActionKinds.filter(
            (value) =>
              value === action?.kind ||
              triggersFor(value, line.twoSided).length > 0,
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

function CornersMenu({
  ids,
  ...props
}: BodyProps & { ids: string[]; target: MapTarget }) {
  const { map, target, onCommit, onSelect, grid } = props;
  const corners = ids.flatMap((id) => map.vertices[id] ?? []);
  if (corners.length === 0) return null;
  const walls = [...wallOwners(map).keys()].filter((wall) =>
    wall.split("|").includes(ids[0]),
  ).length;
  const snapped = corners.every(({ x, y }) => x % grid === 0 && y % grid === 0);
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
      <Rule />
      <CameraItem {...props} point={target.point ?? corners[0]} />
    </>
  );
}

function SwitchMenu({
  id,
  ...props
}: BodyProps & { id: string; target: MapTarget }) {
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

function EmptyMenu(props: BodyProps & { target: MapTarget }) {
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

function MenuBody({ target, ...props }: BodyProps & { target: MapTarget }) {
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

function MapContextMenu({
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

export { MapContextMenu };
