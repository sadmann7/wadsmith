import type { GameMap, Point, Sector } from "./types";

import { findVertexAt, splitWall } from "./edit";
import {
  cross,
  loopEdges,
  onSegment,
  sectorEdges,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
} from "./geometry";

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

export interface Touch {
  room: Sector;
  other: Sector;
  at: Point;
}

// Rooms that meet this one only at a point, where a corner of one sits on the
// other's wall or corner, so the two look joined but share no wall.
export function findTouches(map: GameMap, room: Sector): Touch[] {
  if (room.door) return [];
  const neighbours = new Set<Sector>();
  for (const owners of wallOwners(map).values()) {
    if (owners.includes(room))
      for (const owner of owners) neighbours.add(owner);
  }
  const outline = (sector: Sector) =>
    loopEdges(sector.vertices).map(({ from, to }) => ({
      a: map.vertices[from],
      b: map.vertices[to],
    }));
  const mine = outline(room);
  const touches: Touch[] = [];
  for (const other of map.sectors) {
    if (other === room || other.door || neighbours.has(other)) continue;
    const theirs = outline(other);
    const at =
      mine.find(({ a }) => theirs.some((edge) => onSegment(edge.a, edge.b, a)))
        ?.a ??
      theirs.find(({ a }) => mine.some((edge) => onSegment(edge.a, edge.b, a)))
        ?.a;
    if (at) touches.push({ room, other, at });
  }
  return touches;
}

// Joins two rooms that touch at a point: the pointed room's corner opens out
// along the other room's straight wall, so the two share a wall there.
export function joinTouch(map: GameMap, { room, other, at }: Touch) {
  const split = joinWalls(map, [room.id, other.id]);
  if (getShareWall(split, room.id, other.id)) return split;
  const point = findVertexAt(split, at);
  if (!point) return null;
  for (const [pointed, flat] of [
    [room.id, other.id],
    [other.id, room.id],
  ]) {
    const opened = openCorner(split, point, pointed, flat);
    if (opened && getShareWall(opened, room.id, other.id)) return opened;
  }
  return null;
}

// Half the width of the opening a corner join makes, either side of the point.
const openingHalf = 64;
const narrowestOpening = 40;

function openCorner(
  map: GameMap,
  point: string,
  pointed: string,
  flat: string,
) {
  const pointedRoom = map.sectors.find((sector) => sector.id === pointed);
  const flatRoom = map.sectors.find((sector) => sector.id === flat);
  if (!pointedRoom || !flatRoom) return null;
  const at = pointedRoom.vertices.indexOf(point);
  const along = flatRoom.vertices.indexOf(point);
  if (at < 0 || along < 0) return null;
  const p = map.vertices[point];
  const sides = [
    ring(flatRoom.vertices, along - 1),
    ring(flatRoom.vertices, along + 1),
  ];
  const [u, w] = sides.map((id) => map.vertices[id]);
  const dot = (u.x - p.x) * (w.x - p.x) + (u.y - p.y) * (w.y - p.y);
  if (cross(u, p, w) !== 0 || dot >= 0) return null;
  let next = map;
  const ends: string[] = [];
  for (const side of sides) {
    const end = next.vertices[side];
    const length = Math.hypot(end.x - p.x, end.y - p.y);
    if (length <= openingHalf) {
      ends.push(side);
      continue;
    }
    const scale = openingHalf / length;
    const cut = splitWall(
      next,
      wallKey(point, side),
      { x: p.x + (end.x - p.x) * scale, y: p.y + (end.y - p.y) * scale },
      1,
      true,
    );
    if (!cut) return null;
    next = cut.map;
    ends.push(cut.id);
  }
  const [first, second] = ends.map((id) => next.vertices[id]);
  if (Math.hypot(first.x - second.x, first.y - second.y) < narrowestOpening) {
    return null;
  }
  const loop = pointedRoom.vertices;
  const before = ring(loop, at - 1);
  const after = ring(loop, at + 1);
  const span = (a: string, b: string) =>
    Math.hypot(
      next.vertices[a].x - next.vertices[b].x,
      next.vertices[a].y - next.vertices[b].y,
    );
  const order =
    span(before, ends[0]) + span(ends[1], after) <=
    span(before, ends[1]) + span(ends[0], after)
      ? ends
      : [ends[1], ends[0]];
  if (order.includes(before) || order.includes(after)) return null;
  const vertices = [...loop.slice(0, at), ...order, ...loop.slice(at + 1)];
  const area = (ids: string[]) =>
    signedArea(ids.map((id) => next.vertices[id]));
  if (Math.sign(area(vertices)) !== Math.sign(area(loop))) return null;
  const fresh = [
    [before, order[0]],
    [order[1], after],
  ];
  const crosses = next.sectors.some((sector) =>
    sectorEdges(sector).some(({ from, to }) =>
      fresh.some(
        ([a, b]) =>
          ![a, b].includes(from) &&
          ![a, b].includes(to) &&
          segmentsIntersect(
            next.vertices[a],
            next.vertices[b],
            next.vertices[from],
            next.vertices[to],
          ),
      ),
    ),
  );
  if (crosses) return null;
  const opened = {
    ...next,
    sectors: next.sectors.map((sector) =>
      sector.id === pointed ? { ...sector, vertices } : sector,
    ),
  };
  return joinWalls(opened, [pointed]);
}

function getShareWall(map: GameMap, first: string, second: string) {
  for (const owners of wallOwners(map).values()) {
    const ids = owners.map((owner) => owner.id);
    if (ids.includes(first) && ids.includes(second)) return true;
  }
  return false;
}

function ring(loop: string[], index: number) {
  return loop[(index + loop.length) % loop.length];
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
