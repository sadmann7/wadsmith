import type { GameMap, Point } from "./types";

import { splitWall } from "./edit";
import { cross, sectorEdges, wallKey, wallOwners } from "./geometry";

interface Cut {
  wall: string;
  at: Point;
}

const mostCuts = 512;

// Where a wall of these rooms meets a wall already there, both get a corner
// at that spot and share it. A corner that sits on another wall's length
// becomes a corner of that wall, and two walls that cross get one where they
// cross. A wall that holds a switch stays whole.
export function joinWalls(map: GameMap, ids: string[]): GameMap {
  const skipped = new Set<string>();
  let next = map;
  for (let cuts = 0; cuts < mostCuts; cuts += 1) {
    const cut = findCut(next, new Set(ids), skipped);
    if (!cut) break;
    const split = splitWall(next, cut.wall, cut.at, 1, true);
    if (split) next = split.map;
    else skipped.add(cutKey(cut));
  }
  return next;
}

function findCut(map: GameMap, ids: Set<string>, skipped: Set<string>) {
  const fresh = new Set(
    map.sectors
      .filter((sector) => ids.has(sector.id))
      .flatMap((sector) =>
        sectorEdges(sector).map(({ from, to }) => wallKey(from, to)),
      ),
  );
  const walls = [...wallOwners(map).keys()].map((key) => {
    const [from, to] = key.split("|");
    return { key, from, to, a: map.vertices[from], b: map.vertices[to] };
  });
  const offer = (cut: Cut) => (skipped.has(cutKey(cut)) ? null : cut);
  for (const mine of walls) {
    if (!fresh.has(mine.key)) continue;
    for (const other of walls) {
      if (other.key === mine.key) continue;
      // Two walls of the rooms themselves are the drawn shape's own business.
      if (fresh.has(other.key) && other.key < mine.key) continue;
      const shared = [other.from, other.to].filter(
        (id) => id === mine.from || id === mine.to,
      );
      if (shared.length === 2) continue;
      for (const [id, point] of [
        [other.from, other.a],
        [other.to, other.b],
      ] as const) {
        if (!shared.includes(id) && getIsWithin(mine.a, mine.b, point)) {
          const cut = offer({ wall: mine.key, at: point });
          if (cut) return cut;
        }
      }
      for (const [id, point] of [
        [mine.from, mine.a],
        [mine.to, mine.b],
      ] as const) {
        if (!shared.includes(id) && getIsWithin(other.a, other.b, point)) {
          const cut = offer({ wall: other.key, at: point });
          if (cut) return cut;
        }
      }
      if (shared.length > 0) continue;
      const at = crossing(mine.a, mine.b, other.a, other.b);
      if (!at) continue;
      // Both walls take the same whole-number spot, the nearer one first.
      const cut =
        offer({ wall: mine.key, at }) ?? offer({ wall: other.key, at });
      if (cut) return cut;
    }
  }
  return null;
}

function cutKey({ wall, at }: Cut) {
  return `${wall}@${at.x},${at.y}`;
}

// On the wall's length, and at neither of its ends.
function getIsWithin(a: Point, b: Point, point: Point) {
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

// Where two walls cut through each other, to the nearest whole unit, or null
// when they only touch or miss.
function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
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
  const ends = [a, b, c, d];
  return ends.some((end) => end.x === at.x && end.y === at.y) ? null : at;
}
