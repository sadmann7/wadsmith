import type { GameMap, Point } from "./types";

import { splitWall } from "./edit";
import { cross, sectorEdges, wallKey } from "./geometry";

interface Wall {
  key: string;
  from: string;
  to: string;
  a: Point;
  b: Point;
}

interface Cut {
  walls: string[];
  at: Point;
}

const mostCuts = 512;

// Where a wall of these rooms meets a wall already there, both get a corner
// at that spot and share it. A corner on another wall's length becomes a
// corner of that wall, and two walls that cross get one where they cross. A
// wall that holds a switch stays whole.
export function joinWalls(map: GameMap, ids: string[]): GameMap {
  const rooms = new Set(ids);
  const skipped = new Set<string>();
  let next = map;
  for (let cuts = 0; cuts < mostCuts; cuts += 1) {
    const cut = findCut(next, rooms, skipped);
    if (!cut) break;
    let changed = false;
    for (const wall of cut.walls) {
      const split = splitWall(next, wall, cut.at, 1, true);
      if (!split) continue;
      next = split.map;
      changed = true;
    }
    if (!changed) skipped.add(cutKey(cut));
  }
  return next;
}

// On the wall's length, and at neither of its ends.
export function getIsWithin(a: Point, b: Point, point: Point) {
  return (
    cross(a, b, point) === 0 &&
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y) &&
    !(point.x === a.x && point.y === a.y) &&
    !(point.x === b.x && point.y === b.y)
  );
}

// Where two walls cut through each other, on whole units, or null when they
// only touch or miss. A crossing within a unit of a wall's end is that end,
// so no wall a unit long is left over.
export function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 * d2 >= 0 || d3 * d4 >= 0) return null;
  const along = d1 / (d1 - d2);
  const at = {
    x: Math.round(a.x + (b.x - a.x) * along),
    y: Math.round(a.y + (b.y - a.y) * along),
  };
  return (
    [a, b, c, d].find(
      (end) => Math.abs(end.x - at.x) <= 1 && Math.abs(end.y - at.y) <= 1,
    ) ?? at
  );
}

// Only the walls near the rooms are looked at, so a room drawn in one corner
// of a big map costs the same as on a small one.
function findCut(map: GameMap, rooms: Set<string>, skipped: Set<string>) {
  const fresh = new Map<string, Wall>();
  const others = new Map<string, Wall>();
  for (const sector of map.sectors) {
    const into = rooms.has(sector.id) ? fresh : others;
    for (const { from, to } of sectorEdges(sector)) {
      const key = wallKey(from, to);
      into.set(key, {
        key,
        from,
        to,
        a: map.vertices[from],
        b: map.vertices[to],
      });
    }
  }
  if (fresh.size === 0) return null;
  const points = [...fresh.values()].flatMap(({ a, b }) => [a, b]);
  const left = Math.min(...points.map((point) => point.x)) - 1;
  const right = Math.max(...points.map((point) => point.x)) + 1;
  const top = Math.min(...points.map((point) => point.y)) - 1;
  const bottom = Math.max(...points.map((point) => point.y)) + 1;
  const near = [...others.values()].filter(
    ({ key, a, b }) =>
      !fresh.has(key) &&
      Math.max(a.x, b.x) >= left &&
      Math.min(a.x, b.x) <= right &&
      Math.max(a.y, b.y) >= top &&
      Math.min(a.y, b.y) <= bottom,
  );
  const offer = (cut: Cut) => (skipped.has(cutKey(cut)) ? null : cut);
  for (const mine of fresh.values()) {
    for (const other of near) {
      const shared = [other.from, other.to].filter(
        (id) => id === mine.from || id === mine.to,
      );
      if (shared.length === 2) continue;
      for (const [id, point] of [
        [other.from, other.a],
        [other.to, other.b],
      ] as const) {
        if (!shared.includes(id) && getIsWithin(mine.a, mine.b, point)) {
          const cut = offer({ walls: [mine.key], at: point });
          if (cut) return cut;
        }
      }
      for (const [id, point] of [
        [mine.from, mine.a],
        [mine.to, mine.b],
      ] as const) {
        if (!shared.includes(id) && getIsWithin(other.a, other.b, point)) {
          const cut = offer({ walls: [other.key], at: point });
          if (cut) return cut;
        }
      }
      if (shared.length > 0) continue;
      const at = crossing(mine.a, mine.b, other.a, other.b);
      const cut = at && offer({ walls: [mine.key, other.key], at });
      if (cut) return cut;
    }
  }
  return null;
}

function cutKey({ walls, at }: Cut) {
  return `${walls.join("+")}@${at.x},${at.y}`;
}
