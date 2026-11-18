import type { MouseEvent as ReactMouseEvent } from "react";

import { roomCenter, thingKeyPrefix, switchKeyPrefix } from "../map/edit";
import { sectorAt, sectorEdges, wallKey, wallOwners } from "../map/geometry";
import { parseSurface, surfaceKey } from "../map/surfaces";
import type { GameMap, Point, Sector } from "../map/types";

type MapTarget = {
  point: Point | null;
  surface?: string;
  keepSelection?: boolean;
} & (
  | { kind: "things"; ids: string[] }
  | { kind: "corners"; ids: string[] }
  | { kind: "room"; sector: string }
  | { kind: "wall"; sector: string; wall: string }
  | { kind: "switch"; id: string }
  | { kind: "empty" }
);

const nearThing = 48;
const standOff = 96;

function isKeyboardMenu(event: MouseEvent) {
  const { pointerType } = event as PointerEvent;
  return event.button !== 2 && pointerType !== "touch" && pointerType !== "pen";
}

// macOS reports Control-click as the primary button before its context menu.
function isSecondaryPress(event: MouseEvent) {
  return (
    event.button === 2 ||
    (event.button === 0 &&
      event.ctrlKey &&
      /Mac/.test(globalThis.navigator?.platform ?? ""))
  );
}

function isDragging(event: MouseEvent) {
  return event.button === 2 && (event.buttons & 5) !== 0;
}

// The menu reads button 2 as a pointer press and anything else as the keyboard.
function normalizeControlClick(event: ReactMouseEvent) {
  const { nativeEvent } = event;
  if (nativeEvent.button !== 0 || !isSecondaryPress(nativeEvent)) return;
  event.preventDefault();
  event.stopPropagation();
  event.target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: nativeEvent.clientX,
      clientY: nativeEvent.clientY,
    }),
  );
}

// macOS browsers send no context menu event for Shift+F10.
function openMenuFromKey(event: KeyboardEvent) {
  if (!event.shiftKey || event.key !== "F10") return false;
  event.preventDefault();
  event.target?.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  return true;
}

function canStand(map: GameMap, point: Point | null) {
  const sector = point ? sectorAt(map, point) : null;
  return Boolean(sector && !sector.door);
}

function targetForKeys(
  keys: string[],
  point: Point | null,
  pressed = keys[0],
): MapTarget | null {
  const things = keys.filter((key) => key.startsWith(thingKeyPrefix));
  const switches = keys.filter((key) => key.startsWith(switchKeyPrefix));
  const corners = keys.filter(
    (key) => !things.includes(key) && !switches.includes(key),
  );
  const keepSelection = keys.length > 1;
  if (things.includes(pressed)) {
    return {
      kind: "things",
      ids: things.map((key) => key.slice(thingKeyPrefix.length)),
      point,
      keepSelection,
    };
  }
  if (switches.includes(pressed)) {
    return {
      kind: "switch",
      id: pressed.slice(switchKeyPrefix.length),
      point,
      keepSelection,
    };
  }
  return corners.length > 0
    ? { kind: "corners", ids: corners, point, keepSelection }
    : null;
}

function targetExists(map: GameMap, target: MapTarget) {
  if (target.kind === "things") {
    return target.ids.some((id) => map.things.some((item) => item.id === id));
  }
  if (target.kind === "corners") {
    return target.ids.some((id) => map.vertices[id]);
  }
  if (target.kind === "switch") {
    return map.switches.some((item) => item.id === target.id);
  }
  if (target.kind === "empty") return true;
  const room = map.sectors.find((sector) => sector.id === target.sector);
  if (!room || target.kind === "room") return Boolean(room);
  return sectorEdges(room).some(
    ({ from, to }) => wallKey(from, to) === target.wall,
  );
}

function targetForSurface(
  map: GameMap,
  key: string,
  point: Point | null,
): MapTarget | null {
  const surface = parseSurface(key);
  if (!surface) return null;
  if (surface.kind === "thing") {
    return { kind: "things", ids: [surface.thing], point, surface: key };
  }
  if (surface.kind !== "wall") {
    return { kind: "room", sector: surface.sector, point, surface: key };
  }
  const item = map.switches.find(
    (entry) => wallKey(entry.from, entry.to) === surface.wall,
  );
  return item
    ? { kind: "switch", id: item.id, point, surface: key }
    : {
        kind: "wall",
        sector: surface.sector,
        wall: surface.wall,
        point,
        surface: key,
      };
}

function wallTarget(sector: string, wall: string, point: Point | null) {
  return {
    kind: "wall" as const,
    sector,
    wall,
    point,
    surface: surfaceKey({ kind: "wall", sector, wall, part: "middle" }),
  };
}

function wallMiddle(map: GameMap, wall: string): Point {
  const [from, to] = wall.split("|").map((id) => map.vertices[id]);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function standingRoom(owners: Sector[] | undefined) {
  return owners?.find((sector) => !sector.door) ?? null;
}

function viewFrom(map: GameMap, room: Sector, at: Point) {
  const center = roomCenter(map, room);
  if (Math.hypot(center.x - at.x, center.y - at.y) >= nearThing) return center;
  const spots = [
    { x: at.x - standOff, y: at.y },
    { x: at.x + standOff, y: at.y },
    { x: at.x, y: at.y - standOff },
    { x: at.x, y: at.y + standOff },
  ];
  return spots.find((spot) => sectorAt(map, spot) === room) ?? center;
}

function targetForIssue(map: GameMap, id: string): MapTarget | null {
  if (id.includes("|")) {
    const owner = wallOwners(map).get(id)?.[0];
    return owner ? wallTarget(owner.id, id, null) : null;
  }
  if (map.sectors.some((sector) => sector.id === id)) {
    return { kind: "room", sector: id, point: null };
  }
  if (map.switches.some((item) => item.id === id)) {
    return { kind: "switch", id, point: null };
  }
  return map.things.some((thing) => thing.id === id)
    ? { kind: "things", ids: [id], point: null }
    : null;
}

function pointOfTarget(map: GameMap, target: MapTarget): Point | null {
  if (target.kind === "room") {
    const room = map.sectors.find((sector) => sector.id === target.sector);
    return room ? roomCenter(map, room) : null;
  }
  if (target.kind === "things") {
    const thing = map.things.find((item) => item.id === target.ids[0]);
    return thing ? { x: thing.x, y: thing.y } : null;
  }
  if (target.kind === "wall") return wallMiddle(map, target.wall);
  if (target.kind === "switch") {
    const item = map.switches.find((entry) => entry.id === target.id);
    return item ? wallMiddle(map, wallKey(item.from, item.to)) : null;
  }
  return target.point;
}

function viewOfTarget(map: GameMap, target: MapTarget) {
  if (target.kind === "room") {
    const room = map.sectors.find((sector) => sector.id === target.sector);
    return room && !room.door
      ? { from: roomCenter(map, room), at: null }
      : null;
  }
  if (target.kind === "things") {
    const thing = map.things.find((item) => item.id === target.ids[0]);
    const room = thing ? sectorAt(map, thing) : null;
    return thing && room && !room.door
      ? { from: viewFrom(map, room, thing), at: { x: thing.x, y: thing.y } }
      : null;
  }
  let wall: string | null = null;
  if (target.kind === "wall") wall = target.wall;
  if (target.kind === "switch") {
    const item = map.switches.find((entry) => entry.id === target.id);
    wall = item ? wallKey(item.from, item.to) : null;
  }
  const room = wall ? standingRoom(wallOwners(map).get(wall)) : null;
  if (!wall || !room) return null;
  const at = wallMiddle(map, wall);
  return { from: viewFrom(map, room, at), at };
}

export {
  canStand,
  isDragging,
  isKeyboardMenu,
  isSecondaryPress,
  normalizeControlClick,
  openMenuFromKey,
  pointOfTarget,
  targetExists,
  targetForIssue,
  targetForKeys,
  targetForSurface,
  viewOfTarget,
  wallMiddle,
  wallTarget,
  type MapTarget,
};
