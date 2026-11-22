import type { GameMap, LineActionKind, Sector, ThingKind } from "./types";

import { thingCatalog } from "./catalog";
import { roomKeyPrefix, thingKeyPrefix, wallKeyPrefix } from "./edit";
import { wallKey, wallOwners, wallPartTexture } from "./geometry";
import { lineActions } from "./lines";
import { wallSurfaces } from "./many-lines";
import { describeSurface } from "./surfaces";

export type RoomLikeness = "floorTexture" | "floor" | "light" | "tag";
export type WallLikeness = "texture" | "action";

export function similarRooms(
  map: GameMap,
  id: string,
  by: RoomLikeness,
): string[] {
  const room = map.sectors.find((sector) => sector.id === id);
  if (!room) return [];
  if (by === "tag" && !room.tag) return [id];
  return map.sectors
    .filter(
      (sector) => sector === room || (!sector.door && sector[by] === room[by]),
    )
    .map((sector) => sector.id);
}

// Walls whose side facing a room shows the same middle texture as this one,
// or that carry the same kind of action.
export function similarWalls(
  map: GameMap,
  wall: string,
  sector: string,
  by: WallLikeness,
): string[] {
  const owners = wallOwners(map);
  if (by === "action") {
    const kind = actionOf(map, wall);
    if (kind === null) return [wall];
    return [...owners.keys()].filter((key) => actionOf(map, key) === kind);
  }
  const room = owners.get(wall)?.find((item) => item.id === sector);
  if (!room) return [wall];
  const texture = wallPartTexture(map, room, wall, "middle");
  return [...owners]
    .filter(([key, rooms]) =>
      rooms.some(
        (item) => wallPartTexture(map, item, key, "middle") === texture,
      ),
    )
    .map(([key]) => key);
}

export function similarThings(map: GameMap, ids: string[]): string[] {
  const kinds = new Set(
    map.things
      .filter((thing) => ids.includes(thing.id))
      .map((thing) => thing.kind),
  );
  return map.things
    .filter((thing) => kinds.has(thing.kind))
    .map((thing) => thing.id);
}

export type FindKind = "wall" | "flat" | "tag" | "action" | "thing";

export interface FindChoice {
  value: string;
  label: string;
  count: number;
}

// What a search can look for, as the map uses it, with how many places each
// one turns up in.
export function findChoices(map: GameMap, kind: FindKind): FindChoice[] {
  const counts = new Map<string, number>();
  const count = (value: string) =>
    counts.set(value, (counts.get(value) ?? 0) + 1);
  if (kind === "wall") {
    for (const [wall, rooms] of wallOwners(map)) {
      for (const texture of new Set(wallTextures(map, wall, rooms))) {
        count(texture);
      }
    }
  } else if (kind === "flat") {
    for (const sector of map.sectors) {
      for (const flat of new Set([
        sector.floorTexture,
        sector.ceilingTexture,
      ])) {
        count(flat);
      }
    }
  } else if (kind === "tag") {
    for (const sector of map.sectors) if (sector.tag) count(String(sector.tag));
  } else if (kind === "action") {
    for (const wall of wallOwners(map).keys()) {
      const action = actionOf(map, wall);
      if (action) count(action);
    }
  } else {
    for (const thing of map.things) count(thing.kind);
  }
  return [...counts]
    .map(([value, total]) => ({
      value,
      label: findLabel(kind, value),
      count: total,
    }))
    .toSorted((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
}

// The selection keys of everything a search turns up: walls, rooms or things.
export function findKeys(map: GameMap, kind: FindKind, value: string) {
  if (kind === "wall") {
    return [...wallOwners(map)]
      .filter(([wall, rooms]) => wallTextures(map, wall, rooms).includes(value))
      .map(([wall]) => `${wallKeyPrefix}${wall}`);
  }
  if (kind === "action") {
    return [...wallOwners(map).keys()]
      .filter((wall) => actionOf(map, wall) === value)
      .map((wall) => `${wallKeyPrefix}${wall}`);
  }
  if (kind === "thing") {
    return map.things
      .filter((thing) => thing.kind === value)
      .map((thing) => `${thingKeyPrefix}${thing.id}`);
  }
  return map.sectors
    .filter((sector) =>
      kind === "flat"
        ? sector.floorTexture === value || sector.ceilingTexture === value
        : String(sector.tag ?? "") === value,
    )
    .map((sector) => `${roomKeyPrefix}${sector.id}`);
}

function findLabel(kind: FindKind, value: string) {
  if (kind === "tag") return `Tag ${value}`;
  if (kind === "thing") return thingCatalog[value as ThingKind]?.label ?? value;
  if (kind === "action") {
    if (value === "switch") return "Door switch";
    if (value.startsWith("raw:")) return `Special ${value.slice(4)}`;
    return lineActions[value as LineActionKind]?.label ?? value;
  }
  return value;
}

// The textures a wall shows: the room wall texture on each side, and a
// see-through middle where one hangs.
function wallTextures(map: GameMap, wall: string, rooms: Sector[]) {
  return [
    ...wallSurfaces(map, wall).flatMap(
      (key) => describeSurface(map, key)?.texture ?? [],
    ),
    ...rooms.flatMap(
      (room) => map.lines?.[wall]?.sides?.[room.id]?.middle ?? [],
    ),
  ];
}

function actionOf(map: GameMap, wall: string) {
  const line = map.lines?.[wall];
  if (line?.action) return line.action.kind;
  if (line?.raw) return `raw:${line.raw.special}`;
  return map.switches.some((item) => wallKey(item.from, item.to) === wall)
    ? "switch"
    : null;
}
