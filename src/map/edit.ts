import {
  pointInPolygon,
  sectorEdges,
  sectorPolygon,
  signedArea,
} from "./geometry";
import type { GameMap, Point, Sector, Thing, ThingKind } from "./types";

const gridSize = 8;
const thingKeyPrefix = "thing:";

function snap(value: number) {
  return Math.round(value / gridSize) * gridSize;
}

function snapPoint(point: Point): Point {
  return { x: snap(point.x), y: snap(point.y) };
}

function nextId(prefix: string, used: Iterable<string>) {
  let highest = 0;
  for (const id of used) {
    if (id.startsWith(prefix)) {
      highest = Math.max(highest, Number(id.slice(prefix.length)) || 0);
    }
  }
  return `${prefix}${highest + 1}`;
}

function positionsOf(map: GameMap): Record<string, Point> {
  const positions: Record<string, Point> = { ...map.vertices };
  for (const thing of map.things) {
    positions[`${thingKeyPrefix}${thing.id}`] = { x: thing.x, y: thing.y };
  }
  return positions;
}

function applyPositions(
  map: GameMap,
  positions: Record<string, Point>,
): GameMap {
  const vertices: Record<string, Point> = {};
  for (const id of Object.keys(map.vertices)) {
    vertices[id] = positions[id] ?? map.vertices[id];
  }
  return {
    ...map,
    vertices,
    things: map.things.map((thing) => ({
      ...thing,
      ...positions[`${thingKeyPrefix}${thing.id}`],
    })),
  };
}

function updateSector(
  map: GameMap,
  id: string,
  patch: Partial<Omit<Sector, "id" | "vertices">>,
): GameMap {
  return {
    ...map,
    sectors: map.sectors.map((sector) =>
      sector.id === id ? { ...sector, ...patch } : sector,
    ),
  };
}

function updateThing(
  map: GameMap,
  id: string,
  patch: Partial<Omit<Thing, "id">>,
): GameMap {
  return {
    ...map,
    things: map.things.map((thing) =>
      thing.id === id ? { ...thing, ...patch } : thing,
    ),
  };
}

function addThing(
  map: GameMap,
  kind: ThingKind,
  point: Point,
  angle = 0,
): { map: GameMap; id: string } {
  const at = snapPoint(point);
  const things =
    kind === "player"
      ? map.things.filter((thing) => thing.kind !== "player")
      : map.things;
  const id = nextId(
    `${kind}-`,
    map.things.map((thing) => thing.id),
  );
  return {
    id,
    map: { ...map, things: [...things, { id, kind, angle, ...at }] },
  };
}

function removeThing(map: GameMap, id: string): GameMap {
  return { ...map, things: map.things.filter((thing) => thing.id !== id) };
}

function removeSector(map: GameMap, id: string): GameMap {
  const sectors = map.sectors.filter((sector) => sector.id !== id);
  const used = new Set(sectors.flatMap((sector) => sector.vertices));
  return {
    ...map,
    sectors,
    vertices: Object.fromEntries(
      Object.entries(map.vertices).filter(([vertex]) => used.has(vertex)),
    ),
  };
}

function findVertexAt(map: GameMap, point: Point) {
  return Object.entries(map.vertices).find(
    ([, vertex]) => vertex.x === point.x && vertex.y === point.y,
  )?.[0];
}

function roomDefaults(index: number) {
  return {
    name: `Room ${index}`,
    floor: 0,
    ceiling: 128,
    light: 160,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
  };
}

// A wall drawn along an existing one must use that wall's corners, or the two
// rooms overlap without being connected, so new rooms reuse matching corners.
function addRoom(
  map: GameMap,
  corners: Point[],
  patch: Partial<Omit<Sector, "id" | "vertices">> = {},
): { map: GameMap; id: string } {
  const vertices = { ...map.vertices };
  const loop = corners.map((corner) => {
    const point = snapPoint(corner);
    const existing = findVertexAt({ ...map, vertices }, point);
    if (existing) return existing;
    const id = nextId("v", Object.keys(vertices));
    vertices[id] = point;
    return id;
  });
  const id = nextId(
    "sector-",
    map.sectors.map((sector) => sector.id),
  );
  const index = map.sectors.length + 1;
  return {
    id,
    map: {
      ...map,
      vertices,
      sectors: [
        ...map.sectors,
        { id, vertices: loop, ...roomDefaults(index), ...patch },
      ],
    },
  };
}

type RoomSide = "north" | "east" | "south" | "west";

const sideNormals: Record<RoomSide, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

// Builds on the wall facing `side` so the new room is connected through it.
function addRoomOnSide(
  map: GameMap,
  sectorId: string,
  side: RoomSide,
  depth: number,
  patch: Partial<Omit<Sector, "id" | "vertices">> = {},
): { map: GameMap; id: string } | null {
  const sector = map.sectors.find((item) => item.id === sectorId);
  if (!sector) return null;
  const clockwise = signedArea(sectorPolygon(map, sector)) > 0;
  const normal = sideNormals[side];
  const taken = new Map<string, number>();
  for (const other of map.sectors) {
    if (other.id === sector.id) continue;
    for (const edge of sectorEdges(other)) {
      taken.set([edge.from, edge.to].toSorted().join("|"), 1);
    }
  }

  let best: { from: string; to: string; score: number } | null = null;
  for (const edge of sectorEdges(sector)) {
    if (taken.has([edge.from, edge.to].toSorted().join("|"))) continue;
    const a = map.vertices[edge.from];
    const b = map.vertices[edge.to];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const outward = clockwise
      ? { x: dy / length, y: -dx / length }
      : { x: -dy / length, y: dx / length };
    const facing = outward.x * normal.x + outward.y * normal.y;
    if (facing < 0.7) continue;
    const score = facing * length;
    if (!best || score > best.score) {
      best = { from: edge.from, to: edge.to, score };
    }
  }
  if (!best) return null;

  const a = map.vertices[best.from];
  const b = map.vertices[best.to];
  const offset = { x: normal.x * depth, y: normal.y * depth };
  return addRoom(
    map,
    [
      a,
      { x: a.x + offset.x, y: a.y + offset.y },
      { x: b.x + offset.x, y: b.y + offset.y },
      b,
    ],
    patch,
  );
}

function roomCenter(map: GameMap, sector: Sector): Point {
  const polygon = sectorPolygon(map, sector);
  const average = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  };
  if (pointInPolygon(average, polygon)) return snapPoint(average);
  for (let index = 0; index < polygon.length; index += 1) {
    const before = polygon[index];
    const after = polygon[(index + 2) % polygon.length];
    const middle = { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 };
    if (pointInPolygon(middle, polygon)) return snapPoint(middle);
  }
  return snapPoint(polygon[0]);
}

export {
  addRoom,
  addRoomOnSide,
  addThing,
  applyPositions,
  findVertexAt,
  gridSize,
  positionsOf,
  removeSector,
  removeThing,
  roomCenter,
  snap,
  snapPoint,
  thingKeyPrefix,
  updateSector,
  updateThing,
  type RoomSide,
};
