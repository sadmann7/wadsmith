import type { GameMap, LineSettings, Point, Sector } from "./types";

import { roomCenter } from "./edit";
import { pointInSector } from "./geometry";
import { lineUsesTag } from "./lines";

// A line and something it acts on at a distance: the middle of a room it
// moves, or the spot a teleporter lands on.
export interface MapLink {
  from: Point;
  to: Point;
}

// What the line on this wall acts on, by its tag.
export function lineLinks(map: GameMap, wall: string): MapLink[] {
  const line = map.lines?.[wall];
  const tag = tagOf(line);
  if (!tag) return [];
  const from = wallMiddle(map, wall);
  return map.sectors
    .filter((sector) => sector.tag === tag)
    .map((sector) => ({ from, to: landing(map, sector, line) }));
}

// The lines that act on this room, by its tag.
export function sectorLinks(map: GameMap, id: string): MapLink[] {
  const sector = map.sectors.find((item) => item.id === id);
  if (!sector?.tag) return [];
  return Object.entries(map.lines ?? {}).flatMap(([wall, line]) =>
    tagOf(line) === sector.tag && wall.split("|").every((v) => map.vertices[v])
      ? [{ from: wallMiddle(map, wall), to: landing(map, sector, line) }]
      : [],
  );
}

function tagOf(line: LineSettings | undefined) {
  if (line?.action) return lineUsesTag(line.action) ? line.action.tag : 0;
  return line?.raw?.tag ?? 0;
}

function wallMiddle(map: GameMap, wall: string): Point {
  const [from, to] = wall.split("|").map((id) => map.vertices[id]);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function landing(
  map: GameMap,
  sector: Sector,
  line: LineSettings | undefined,
): Point {
  const kind = line?.action?.kind;
  const spot =
    kind === "teleport" || kind === "teleport-monsters"
      ? map.things.find(
          (thing) =>
            thing.kind === "teleport-destination" &&
            pointInSector(map, sector, thing),
        )
      : undefined;
  return spot ? { x: spot.x, y: spot.y } : roomCenter(map, sector);
}
