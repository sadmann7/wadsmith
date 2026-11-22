import type { GameMap } from "./types";

import { wallKey, wallOwners, wallPartTexture } from "./geometry";

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

function actionOf(map: GameMap, wall: string) {
  const line = map.lines?.[wall];
  if (line?.action) return line.action.kind;
  if (line?.raw) return `raw:${line.raw.special}`;
  return map.switches.some((item) => wallKey(item.from, item.to) === wall)
    ? "switch"
    : null;
}
