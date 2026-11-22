import type { GameMap, LineSide, Point, Sector } from "./types";

import { splitWall, updateLine, updateLineSide, updateSector } from "./edit";
import {
  loopEdges,
  sectorAt,
  sectorPolygon,
  signedArea,
  wallKey,
  wallOwners,
  wallPartTexture,
  wallTextureOf,
} from "./geometry";
import { describeLine } from "./lines";
import { drawLines } from "./reshape";

export const mostSegments = 64;

// Bends each wall into an arc of that many segments, its middle pushed that
// far out from the room on its front, or into it when the distance is
// negative. The new corners land on whole units.
export function curveWalls(
  map: GameMap,
  walls: string[],
  segments: number,
  distance: number,
): GameMap {
  const count = Math.max(2, Math.min(mostSegments, Math.round(segments)));
  if (distance === 0) return map;
  return walls.reduce((next, wall) => {
    const [from, to] = wall.split("|");
    const a = next.vertices[from];
    const b = next.vertices[to];
    const owner = wallOwners(next).get(wall)?.[0];
    if (!a || !b || !owner) return next;
    const room = describeLine(next, wall, owner.id).front;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return next;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const probe = { x: middle.x + normal.x, y: middle.y + normal.y };
    // The innermost room at the probe, since a room around a nested one
    // covers both sides of its walls.
    if (sectorAt(next, probe)?.id === room.id) {
      normal = { x: -normal.x, y: -normal.y };
    }
    let current = next;
    let start = from;
    for (let index = 1; index < count; index += 1) {
      const along = index / count;
      const point = arcPoint(a, b, normal, distance, along);
      const split = splitWall(current, wallKey(start, to), point, 1, true);
      // A point that rounds onto the corner before it is left out.
      if (!split) continue;
      current = split.map;
      start = split.id;
    }
    return current;
  }, map);
}

// Turns each wall between two rooms round, so its other room is in front,
// which decides the side a switch or a walk-over action works from. A wall
// with nothing behind it, or with a door, keeps the way it faces.
export function flipWalls(map: GameMap, walls: string[]): GameMap {
  return walls.reduce((next, wall) => {
    const owner = wallOwners(next).get(wall)?.[0];
    if (!owner) return next;
    const line = describeLine(next, wall, owner.id);
    if (!line.back || line.back === line.front) return next;
    if (line.front.door || line.back.door) return next;
    return updateLine(next, wall, { front: line.back.id });
  }, map);
}

// Swaps what each side of a wall between two rooms shows: the upper and
// lower textures each side ends up with, a see-through middle, and the
// offsets. A door's wall keeps its sides, since its face is the door's.
export function swapWallSides(map: GameMap, walls: string[]): GameMap {
  return walls.reduce((next, wall) => {
    const rooms = [...new Set(wallOwners(next).get(wall) ?? [])];
    if (rooms.length !== 2 || rooms.some((room) => room.door)) return next;
    const [first, second] = rooms;
    const shown = (room: Sector): LineSide => {
      const side = next.lines?.[wall]?.sides?.[room.id];
      return {
        upper: wallPartTexture(next, room, wall, "upper"),
        lower: wallPartTexture(next, room, wall, "lower"),
        middle: side?.middle,
        offsetX: side?.offsetX,
        offsetY: side?.offsetY,
      };
    };
    const one = shown(first);
    const other = shown(second);
    if (JSON.stringify(one) === JSON.stringify(other)) return next;
    // Each side keeps only what differs from its own room's wall texture.
    const fitted = (room: Sector, side: LineSide): LineSide => ({
      ...side,
      upper: side.upper === wallTextureOf(room, wall) ? undefined : side.upper,
      lower: side.lower === wallTextureOf(room, wall) ? undefined : side.lower,
    });
    return updateLineSide(
      updateLineSide(next, wall, first.id, fitted(first, other)),
      wall,
      second.id,
      fitted(second, one),
    );
  }, map);
}

// Steps the rooms from one end of their run, each a step above the last, or
// below with a negative step, and with ceilings each keeps its headroom.
// Null unless the rooms make one run, each joined to the next, unbranched.
export function stairRooms(
  map: GameMap,
  ids: string[],
  step: number,
  ceilings: boolean,
): GameMap | null {
  const order = runOrder(map, ids);
  const first = order && map.sectors.find((sector) => sector.id === order[0]);
  if (!order || !first) return null;
  return order.reduce((next, id, index) => {
    const room = next.sectors.find((sector) => sector.id === id);
    if (!room) return next;
    const floor = first.floor + step * index;
    return updateSector(next, id, {
      floor,
      ...(ceilings && !room.door
        ? { ceiling: room.ceiling + (floor - room.floor) }
        : {}),
    });
  }, map);
}

// Cuts a room into steps across its longer side, then stairs them from one
// end. Null when the cuts would reach into another room.
export function splitIntoSteps(
  map: GameMap,
  id: string,
  count: number,
  step: number,
  ceilings: boolean,
): { map: GameMap; rooms: string[] } | null {
  const room = map.sectors.find((sector) => sector.id === id);
  if (!room || room.door || count < 2) return null;
  const polygon = sectorPolygon(map, room);
  const left = Math.min(...polygon.map((point) => point.x));
  const right = Math.max(...polygon.map((point) => point.x));
  const top = Math.min(...polygon.map((point) => point.y));
  const bottom = Math.max(...polygon.map((point) => point.y));
  const across = right - left >= bottom - top;
  const others = new Map(
    map.sectors
      .filter((sector) => sector.id !== id)
      .map((sector) => [sector.id, areaOf(map, sector)]),
  );
  let next = map;
  for (let index = 1; index < count; index += 1) {
    const share = index / count;
    // The cut runs from wall to wall of the room, ending on them so it
    // reaches into nothing beside it.
    const at = across
      ? Math.round(left + (right - left) * share)
      : Math.round(top + (bottom - top) * share);
    const hits = crossings(polygon, across, at);
    if (hits.length < 2) return null;
    const ends = [Math.min(...hits), Math.max(...hits)].map(Math.round);
    const line = across
      ? ends.map((y) => ({ x: at, y }))
      : ends.map((x) => ({ x, y: at }));
    const drawn = drawLines(next, line, 1);
    if (!drawn) return null;
    next = drawn.map;
  }
  // Every other room must come out the same shape, though a wall it shares
  // may have gained a corner.
  const kept = next.sectors.filter(
    (sector) => others.get(sector.id) === areaOf(next, sector),
  ).length;
  if (kept !== others.size) return null;
  const pieces = next.sectors
    .filter((sector) => !others.has(sector.id))
    .map((sector) => {
      const points = sectorPolygon(next, sector);
      const middle =
        points.reduce((sum, point) => sum + (across ? point.x : point.y), 0) /
        points.length;
      return { id: sector.id, middle };
    })
    .toSorted((a, b) => a.middle - b.middle)
    .map((piece) => piece.id);
  if (pieces.length !== count) return null;
  const stepped = pieces.reduce((current, piece, index) => {
    const floor = room.floor + step * index;
    return updateSector(current, piece, {
      floor,
      ...(ceilings ? { ceiling: room.ceiling + step * index } : {}),
    });
  }, next);
  return { map: stepped, rooms: pieces };
}

// A point on the circle through both ends of a wall whose middle bulges out
// by the distance, the share of the way along it.
function arcPoint(
  a: Point,
  b: Point,
  normal: Point,
  bulge: number,
  along: number,
): Point {
  const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const sagitta = Math.abs(bulge);
  const radius = (half * half + sagitta * sagitta) / (2 * sagitta);
  const side = Math.sign(bulge);
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const center = {
    x: middle.x - normal.x * side * (radius - sagitta),
    y: middle.y - normal.y * side * (radius - sagitta),
  };
  const angleOf = (point: Point) =>
    Math.atan2(point.y - center.y, point.x - center.x);
  const start = angleOf(a);
  let sweep = angleOf(b) - start;
  // The arc goes the way round that passes through the bulge.
  const peak = {
    x: middle.x + normal.x * side * sagitta,
    y: middle.y + normal.y * side * sagitta,
  };
  const toPeak = normalized(angleOf(peak) - start);
  sweep = normalized(sweep);
  if (toPeak > sweep) sweep -= 2 * Math.PI;
  const turn = start + sweep * along;
  return {
    x: Math.round(center.x + radius * Math.cos(turn)),
    y: Math.round(center.y + radius * Math.sin(turn)),
  };
}

function normalized(angle: number) {
  const full = 2 * Math.PI;
  return ((angle % full) + full) % full;
}

// The rooms in the order a walk along them meets them: from a room that
// touches only one of the others, through the ones sharing a wall with it.
// Null where the run branches, loops or breaks.
function runOrder(map: GameMap, ids: string[]) {
  const rooms = map.sectors.filter((sector) => ids.includes(sector.id));
  const walls = new Map(
    rooms.map((room) => [
      room.id,
      new Set(
        loopEdges(room.vertices).map(({ from, to }) => wallKey(from, to)),
      ),
    ]),
  );
  const touching = (a: string, b: string) =>
    [...(walls.get(a) ?? [])].some((wall) => walls.get(b)?.has(wall));
  const neighbors = (id: string) =>
    rooms.filter((room) => room.id !== id && touching(id, room.id));
  if (rooms.length < 2) return null;
  if (rooms.some((room) => neighbors(room.id).length > 2)) return null;
  const start = rooms.find((room) => neighbors(room.id).length === 1);
  if (!start) return null;
  const order = [start.id];
  while (order.length < rooms.length) {
    const last = order.at(-1) ?? "";
    const next = neighbors(last).find((room) => !order.includes(room.id));
    if (!next) return null;
    order.push(next.id);
  }
  return order;
}

// Where a line across the room at a fixed x, or a fixed y, meets its outline.
function crossings(polygon: Point[], vertical: boolean, at: number) {
  return polygon.flatMap((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const [p, q] = vertical ? [a.x, b.x] : [a.y, b.y];
    if (p === q || (at - p) * (at - q) > 0) return [];
    const along = (at - p) / (q - p);
    return [vertical ? a.y + (b.y - a.y) * along : a.x + (b.x - a.x) * along];
  });
}

function areaOf(map: GameMap, sector: Sector) {
  return Math.abs(signedArea(sectorPolygon(map, sector)));
}
