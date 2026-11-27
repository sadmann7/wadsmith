import type { GameMap, Point, Sector } from "./types";

import { mergeCorners, thingKeyPrefix } from "./edit";
import { copyParts, pasteParts } from "./fragment";
import {
  boxOf,
  cross,
  interiorPoint,
  loopEdges,
  loopPolygon,
  onSegment,
  pointInPolygon,
  sectorContainers,
  sectorVertices,
  wallKey,
} from "./geometry";
import { joinCornersToWalls } from "./reshape";

export interface RoomDrop {
  offset: Point;
  walls: string[];
  isBlocked: boolean;
}

interface Segment {
  key: string;
  a: Point;
  b: Point;
}

interface Outline {
  sector: Sector;
  polygon: Point[];
  holes: Point[][];
  edges: Segment[];
}

// Where the whole rooms among the keys land: pulled flush against a wall
// within reach, and blocked where they'd overlap a room. A copy leaves the
// rooms in place, so they count as rooms it can overlap.
export function planRoomDrop(
  map: GameMap,
  keys: string[],
  offset: Point,
  reach: number,
  copy = false,
): RoomDrop | null {
  const moved = new Set(keys.filter((key) => !key.startsWith(thingKeyPrefix)));
  const rooms = map.sectors.filter((sector) =>
    sectorVertices(sector).every((id) => moved.has(id) && map.vertices[id]),
  );
  if (rooms.length === 0) return null;
  const movedIds = new Set(rooms.map((room) => room.id));
  const containers = sectorContainers(map);
  const holders = new Set(
    rooms.flatMap((room) => {
      const container = containers.get(room.id);
      return container && !movedIds.has(container.id) ? [container.id] : [];
    }),
  );
  const outlines = (sectors: Sector[]): Outline[] =>
    sectors.map((sector) => {
      const polygon = loopPolygon(map, sector.vertices);
      return {
        sector,
        polygon,
        holes: (sector.holes ?? [])
          .filter((hole) => !hole.every((id) => moved.has(id)))
          .map((hole) => loopPolygon(map, hole)),
        edges: loopEdges(sector.vertices).map(({ from, to }) => ({
          key: wallKey(from, to),
          a: map.vertices[from],
          b: map.vertices[to],
        })),
      };
    });
  const mine = outlines(rooms);
  const box = grow(boxOf(mine.flatMap((outline) => outline.polygon)), reach);
  const whole = map.sectors.filter((sector) =>
    sectorVertices(sector).every((id) => map.vertices[id]),
  );
  const others = outlines(
    whole.filter(
      (sector) => copy || !sectorVertices(sector).some((id) => moved.has(id)),
    ),
  );
  // Rooms that share corners with the dragged ones stretch with them.
  const bent = copy
    ? []
    : whole.filter(
        (sector) =>
          !movedIds.has(sector.id) &&
          sector.vertices.some((id) => moved.has(id)),
      );
  const near = (shift: Point) => {
    const reached = shiftBox(box, shift);
    return others.filter((outline) =>
      boxesMeet(boxOf(outline.polygon), reached),
    );
  };

  const judge = (shift: Point) => {
    const placed = mine.map((outline) => moveOutline(outline, shift));
    const around = near(shift);
    const stretched = bent.map((sector) => ({
      id: sector.id,
      polygon: sector.vertices.map((id) =>
        moved.has(id) ? add(map.vertices[id], shift) : map.vertices[id],
      ),
      holes: (sector.holes ?? [])
        .filter((hole) => !hole.every((id) => moved.has(id)))
        .map((hole) => loopPolygon(map, hole)),
    }));
    // A room may sit anywhere inside the room it was drawn in.
    const covers = (
      room: Point[],
      {
        id,
        polygon,
        holes,
      }: { id: string; polygon: Point[]; holes: Point[][] },
    ) =>
      (holders.has(id)
        ? !getIsWithin(room, polygon) && getDoOverlap(room, polygon)
        : getDoOverlap(room, polygon)) ||
      holes.some((hole) => getDoOverlap(room, hole));
    const isBlocked =
      stretched.some(({ polygon }) => getIsTwisted(polygon)) ||
      placed.some(
        (room) =>
          stretched.some((other) => covers(room.polygon, other)) ||
          around.some((other) =>
            covers(room.polygon, { ...other, id: other.sector.id }),
          ),
      );
    const walls = new Set<string>();
    for (const other of around) {
      for (const wall of other.edges) {
        if (
          placed.some((room) =>
            room.edges.some((edge) => getRunAlong(edge, wall)),
          )
        ) {
          walls.add(wall.key);
        }
      }
    }
    return { offset: shift, walls: [...walls], isBlocked };
  };

  const pulls: { shift: Point; distance: number }[] = [];
  for (const other of near(offset)) {
    for (const wall of other.edges) {
      for (const outline of mine) {
        for (const edge of outline.edges) {
          const pull = pullOnto(
            { ...edge, a: add(edge.a, offset), b: add(edge.b, offset) },
            wall,
            reach,
          );
          if (pull) pulls.push(pull);
        }
      }
    }
  }
  pulls.sort((a, b) => a.distance - b.distance);
  const tried = new Set<string>();
  for (const { shift } of pulls) {
    const at = {
      x: Math.round(offset.x + shift.x),
      y: Math.round(offset.y + shift.y),
    };
    const spot = `${at.x},${at.y}`;
    if (tried.has(spot)) continue;
    tried.add(spot);
    const drop = judge(at);
    if (!drop.isBlocked && drop.walls.length > 0) return drop;
  }
  return judge(offset);
}

// A copy takes only the whole rooms among the keys, with the things listed.
export function dropRooms(
  map: GameMap,
  moved: GameMap,
  keys: string[],
  { copy = false, join = true } = {},
): { map: GameMap; keys: string[] } | null {
  const joined = (next: GameMap, landed: string[]) => {
    const corners = landed.filter((key) => !key.startsWith(thingKeyPrefix));
    if (corners.length === 0) return next;
    return mergeCorners(
      join ? joinCornersToWalls(next, corners) : next,
      corners,
    );
  };
  if (!copy) return { map: joined(moved, keys), keys };
  const picked = new Set(keys);
  const fragment = copyParts(moved, {
    sectors: moved.sectors
      .filter((sector) => sectorVertices(sector).every((id) => picked.has(id)))
      .map((sector) => sector.id),
    things: moved.things
      .filter((thing) => picked.has(`${thingKeyPrefix}${thing.id}`))
      .map((thing) => thing.id),
  });
  const pasted = fragment && pasteParts(map, fragment, null, 1, true, false);
  if (!pasted) return null;
  return { map: joined(pasted.map, pasted.keys), keys: pasted.keys };
}

// Whether two rooms' floors overlap anywhere, not only along a wall or at a
// corner they share.
export function getDoOverlap(a: Point[], b: Point[]) {
  if (a.length < 3 || b.length < 3) return false;
  if (!boxesMeet(boxOf(a), boxOf(b), true)) return false;
  for (const [p, q] of ringPairs(a)) {
    for (const [r, s] of ringPairs(b)) {
      if (getIsCrossing(p, q, r, s)) return true;
    }
  }
  return getHasPointIn(a, b) || getHasPointIn(b, a);
}

function moveOutline(outline: Outline, shift: Point): Outline {
  return {
    ...outline,
    polygon: outline.polygon.map((point) => add(point, shift)),
    edges: outline.edges.map((edge) => ({
      ...edge,
      a: add(edge.a, shift),
      b: add(edge.b, shift),
    })),
  };
}

function getRunAlong(edge: Segment, wall: Segment) {
  if (cross(wall.a, wall.b, edge.a) !== 0) return false;
  if (cross(wall.a, wall.b, edge.b) !== 0) return false;
  const along = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y };
  const length = Math.hypot(along.x, along.y);
  return length > 0 && overlapAlong(edge, wall, along, length) > 0;
}

// How far an edge has to move, square to a wall it runs beside, to lie along
// it, when the two overlap along their length and it's within reach.
function pullOnto(edge: Segment, wall: Segment, reach: number) {
  const along = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y };
  const length = Math.hypot(along.x, along.y);
  if (length === 0) return null;
  const turn =
    (edge.b.x - edge.a.x) * along.y - (edge.b.y - edge.a.y) * along.x;
  if (turn !== 0) return null;
  const distance = cross(wall.a, wall.b, edge.a) / length;
  if (Math.abs(distance) > reach) return null;
  if (overlapAlong(edge, wall, along, length) <= 0) return null;
  return {
    shift: {
      x: (distance * along.y) / length,
      y: (-distance * along.x) / length,
    },
    distance: Math.abs(distance),
  };
}

function overlapAlong(
  edge: Segment,
  wall: Segment,
  along: Point,
  length: number,
) {
  const project = (point: Point) =>
    ((point.x - wall.a.x) * along.x + (point.y - wall.a.y) * along.y) / length;
  const from = project(edge.a);
  const to = project(edge.b);
  return Math.min(Math.max(from, to), length) - Math.max(Math.min(from, to), 0);
}

// Whether a room lies inside another, touching its walls at most.
function getIsWithin(inner: Point[], outer: Point[]) {
  for (const [p, q] of ringPairs(inner)) {
    for (const [r, s] of ringPairs(outer)) {
      if (getIsCrossing(p, q, r, s)) return false;
    }
  }
  return samplePoints(inner).every(
    (point) => onRing(point, outer) || pointInPolygon(point, outer),
  );
}

// Whether two walls of a room that don't meet at a corner cross each other.
function getIsTwisted(polygon: Point[]) {
  const edges = ringPairs(polygon);
  return edges.some(([p, q], index) =>
    edges.slice(index + 2).some(([r, s]) => getIsCrossing(p, q, r, s)),
  );
}

function getHasPointIn(polygon: Point[], other: Point[]) {
  return samplePoints(polygon).some(
    (point) => !onRing(point, other) && pointInPolygon(point, other),
  );
}

function samplePoints(polygon: Point[]) {
  return [
    ...polygon,
    ...ringPairs(polygon).map(([p, q]) => ({
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
    })),
    interiorPoint(polygon),
  ];
}

function onRing(point: Point, polygon: Point[]) {
  return ringPairs(polygon).some(([p, q]) => onSegment(p, q, point));
}

function getIsCrossing(a: Point, b: Point, c: Point, d: Point) {
  const d1 = Math.sign(cross(c, d, a));
  const d2 = Math.sign(cross(c, d, b));
  const d3 = Math.sign(cross(a, b, c));
  const d4 = Math.sign(cross(a, b, d));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function ringPairs(polygon: Point[]): [Point, Point][] {
  return polygon.map((point, index) => [
    point,
    polygon[(index + 1) % polygon.length],
  ]);
}

function add(point: Point, shift: Point): Point {
  return { x: point.x + shift.x, y: point.y + shift.y };
}

type Box = ReturnType<typeof boxOf>;

function grow(box: Box, by: number): Box {
  return {
    left: box.left - by,
    top: box.top - by,
    right: box.right + by,
    bottom: box.bottom + by,
  };
}

function shiftBox(box: Box, shift: Point): Box {
  return {
    left: box.left + shift.x,
    right: box.right + shift.x,
    top: box.top + shift.y,
    bottom: box.bottom + shift.y,
  };
}

function boxesMeet(a: Box, b: Box, strict = false) {
  return strict
    ? a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom
    : a.left <= b.right &&
        b.left <= a.right &&
        a.top <= b.bottom &&
        b.top <= a.bottom;
}
