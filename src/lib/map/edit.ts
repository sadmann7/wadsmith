import { defined } from "@/lib/defined";

import type {
  DoorSettings,
  GameMap,
  LineSettings,
  LineSide,
  MapSwitch,
  Point,
  Sector,
  Thing,
  ThingKind,
} from "./types";

import { getIsPlayerStart } from "./catalog";
import {
  containerOf,
  loopEdges,
  pointInSector,
  sectorAt,
  sectorEdges,
  sectorLoops,
  sectorPolygon,
  sectorVertices,
  signedArea,
  wallKey,
  wallOwners,
  wallStart,
} from "./geometry";

export const gridSize = 8;
export const gridSizes = [1, 2, 4, 8, 16, 32, 64] as const;
export const thingKeyPrefix = "thing:";
export const switchKeyPrefix = "switch:";
export const doorKeyPrefix = "door:";
const switchWidth = 64;

export const defaultDoor: DoorSettings = {
  opensBy: "use",
  closes: true,
  texture: "BIGDOOR2",
};

export function snap(value: number, grid = gridSize) {
  return Math.round(value / grid) * grid;
}

export function snapPoint(point: Point, grid = gridSize): Point {
  return { x: snap(point.x, grid), y: snap(point.y, grid) };
}

const positionCache = new WeakMap<GameMap, Record<string, Point>>();
const thingPoints = new WeakMap<Thing, Point>();

// The editor reads positions from its map on every render, and a fresh object
// would count as a change that wakes every part on the canvas.
export function positionsOf(map: GameMap): Record<string, Point> {
  const cached = positionCache.get(map);
  if (cached) return cached;
  const positions: Record<string, Point> = { ...map.vertices };
  for (const thing of map.things) {
    let point = thingPoints.get(thing);
    if (!point) {
      point = { x: thing.x, y: thing.y };
      thingPoints.set(thing, point);
    }
    positions[`${thingKeyPrefix}${thing.id}`] = point;
  }
  positionCache.set(map, positions);
  return positions;
}

export function applyPositions(
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
    things: map.things.map((thing) => {
      const at = positions[`${thingKeyPrefix}${thing.id}`];
      return !at || (at.x === thing.x && at.y === thing.y)
        ? thing
        : { ...thing, x: at.x, y: at.y };
    }),
  };
}

export function updateSector(
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

export function updateThing(
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

// Rings of spots around player 1, nearest first, for the starts that join it.
const startOffsets = [48, 96, 144].flatMap((distance) =>
  [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => ({ x: x * distance, y: y * distance })),
);

// Places any missing co-op starts beside player 1's start, facing its way.
export function addPlayerStarts(map: GameMap, players: number) {
  const first = map.things.find((thing) => thing.kind === "player");
  const room = first ? sectorAt(map, first) : null;
  if (!first || !room) return map;
  const fits = (map: GameMap, point: Point) =>
    [-20, 20].every((dx) =>
      [-20, 20].every(
        (dy) => sectorAt(map, { x: point.x + dx, y: point.y + dy }) === room,
      ),
    ) &&
    map.things.every(
      (thing) => Math.hypot(thing.x - point.x, thing.y - point.y) >= 40,
    );
  let next = map;
  for (let player = 2; player <= players; player += 1) {
    const kind = `player-${player}` as ThingKind;
    if (next.things.some((thing) => thing.kind === kind)) continue;
    const spot = startOffsets
      .map((offset) => ({ x: first.x + offset.x, y: first.y + offset.y }))
      .find((point) => fits(next, point));
    if (!spot) break;
    next = addThing(next, kind, spot, first.angle).map;
  }
  return next;
}

export function addThing(
  map: GameMap,
  kind: ThingKind,
  point: Point,
  angle = 0,
  grid = gridSize,
): { map: GameMap; id: string } {
  const at = snapPoint(point, grid);
  const things = getIsPlayerStart(kind)
    ? map.things.filter((thing) => thing.kind !== kind)
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

export function removeThing(map: GameMap, id: string): GameMap {
  return { ...map, things: map.things.filter((thing) => thing.id !== id) };
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function updateLine(
  map: GameMap,
  wall: string,
  patch: Partial<Omit<LineSettings, "sides">>,
): GameMap {
  return setLine(map, wall, { ...map.lines?.[wall], ...patch });
}

export function updateLineSide(
  map: GameMap,
  wall: string,
  sector: string,
  patch: LineSide,
): GameMap {
  const line = map.lines?.[wall];
  const side = withoutUnset({ ...line?.sides?.[sector], ...patch });
  return setLine(map, wall, {
    ...line,
    sides: withoutUnset({ ...line?.sides, [sector]: side }),
  });
}

export function setLineTarget(
  map: GameMap,
  wall: string,
  sectorId: string | null,
): GameMap {
  const { action, raw } = map.lines?.[wall] ?? {};
  if (!action && !raw) return map;
  const sector = map.sectors.find((item) => item.id === sectorId);
  const tag = sector ? sector.tag || unusedTag(map) : 0;
  const tagged = sector ? updateSector(map, sector.id, { tag }) : map;
  return updateLine(
    tagged,
    wall,
    action ? { action: { ...action, tag } } : { raw: { ...defined(raw), tag } },
  );
}

// A door's texture covers every face of it, so faces that chose their own
// give that up.
export function setDoorTexture(
  map: GameMap,
  id: string,
  texture: string,
): GameMap {
  const sector = map.sectors.find((item) => item.id === id);
  if (!sector?.door) return map;
  const walls = new Set(
    sectorEdges(sector).map(({ from, to }) => wallKey(from, to)),
  );
  const painted = updateSector(map, id, {
    door: { ...sector.door, texture },
  });
  return Object.entries(map.lines ?? {}).reduce(
    (next, [wall, line]) =>
      walls.has(wall) && line.sides
        ? Object.keys(line.sides).reduce(
            (inner, side) =>
              updateLineSide(inner, wall, side, { upper: undefined }),
            next,
          )
        : next,
    painted,
  );
}

export function setRoomWalls(
  map: GameMap,
  id: string,
  wallTexture: string,
): GameMap {
  const painted = updateSector(map, id, {
    wallTexture,
    wallOverrides: undefined,
  });
  return Object.entries(map.lines ?? {}).reduce(
    (next, [wall, line]) =>
      line.sides?.[id]
        ? updateLineSide(next, wall, id, { upper: undefined, lower: undefined })
        : next,
    painted,
  );
}

export function addNote(map: GameMap, point: Point, text: string): GameMap {
  const notes = map.notes ?? [];
  const id = nextId(
    "note-",
    notes.map((note) => note.id),
  );
  return {
    ...map,
    notes: [
      ...notes,
      { id, x: Math.round(point.x), y: Math.round(point.y), text },
    ],
  };
}

export function removeNote(map: GameMap, id: string): GameMap {
  const notes = map.notes?.filter((note) => note.id !== id);
  return { ...map, notes: notes?.length ? notes : undefined };
}

export function removeThings(map: GameMap, ids: string[]) {
  return ids.reduce(removeThing, map);
}

export function changeThings(map: GameMap, ids: string[], kind: ThingKind) {
  return ids.reduce((next, id) => updateThing(next, id, { kind }), map);
}

export function updateThings(
  map: GameMap,
  ids: string[],
  patch: (thing: Thing) => Partial<Omit<Thing, "id">>,
) {
  return ids.reduce((next, id) => {
    const thing = next.things.find((item) => item.id === id);
    return thing ? updateThing(next, id, patch(thing)) : next;
  }, map);
}

export function faceThings(map: GameMap, ids: string[], angle: number) {
  return ids.reduce((next, id) => updateThing(next, id, { angle }), map);
}

// A second player start would replace the first, so it is never copied.
export function duplicateThings(map: GameMap, ids: string[]) {
  let next = map;
  const copies: string[] = [];
  for (const id of ids) {
    const thing = map.things.find((item) => item.id === id);
    if (!thing || getIsPlayerStart(thing.kind)) continue;
    const added = addThing(
      next,
      thing.kind,
      copySpot(map, thing),
      thing.angle,
      1,
    );
    next = updateThing(added.map, added.id, {
      skills: thing.skills,
      ambush: thing.ambush,
      multiplayer: thing.multiplayer,
      notDeathmatch: thing.notDeathmatch,
      notCoop: thing.notCoop,
      friendly: thing.friendly,
    });
    copies.push(added.id);
  }
  return { map: next, ids: copies };
}

export function snapCorners(
  map: GameMap,
  ids: string[],
  grid = gridSize,
): GameMap {
  const vertices = { ...map.vertices };
  for (const id of ids) {
    if (vertices[id]) vertices[id] = snapPoint(vertices[id], grid);
  }
  return { ...map, vertices };
}

export function connectedCorners(map: GameMap, ids: string[]) {
  const rooms = map.sectors.filter((sector) =>
    sectorVertices(sector).some((vertex) => ids.includes(vertex)),
  );
  return [...new Set(rooms.flatMap(sectorVertices))];
}

export function removeSector(map: GameMap, id: string): GameMap {
  const sectors = map.sectors.filter((sector) => sector.id !== id);
  const used = new Set(sectors.flatMap(sectorVertices));
  return pruneLines(
    {
      ...map,
      sectors,
      vertices: Object.fromEntries(
        Object.entries(map.vertices).filter(([vertex]) => used.has(vertex)),
      ),
      switches: map.switches
        .filter((item) => item.sector !== id)
        .map((item) => (item.door === id ? { ...item, door: null } : item)),
    },
    id,
  );
}

export function setRoomDoor(
  map: GameMap,
  id: string,
  door: DoorSettings | undefined,
): GameMap {
  const updated = updateSector(map, id, { door });
  if (door) return updated;
  return {
    ...updated,
    switches: map.switches.map((item) =>
      item.door === id ? { ...item, door: null } : item,
    ),
  };
}

export function updateSwitch(
  map: GameMap,
  id: string,
  patch: Partial<Omit<MapSwitch, "id">>,
): GameMap {
  return {
    ...map,
    switches: map.switches.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  };
}

export function removeSwitch(map: GameMap, id: string): GameMap {
  return {
    ...map,
    switches: map.switches.filter((item) => item.id !== id),
  };
}

interface FreeWall {
  sector: string;
  from: string;
  to: string;
}

export function freeWallAt(map: GameMap, wall: string) {
  return (
    freeWalls(map).find((item) => wallKey(item.from, item.to) === wall) ?? null
  );
}

export function freeWallNear(map: GameMap, point: Point, reach: number) {
  let best: FreeWall | null = null;
  let bestDistance = reach;
  for (const wall of freeWalls(map)) {
    const distance = distanceToWall(map, wall, point);
    if (distance <= bestDistance) {
      best = wall;
      bestDistance = distance;
    }
  }
  return best;
}

// A shared wall belongs to two rooms, so the room under the pointer wins the tie.
export function wallNear(map: GameMap, point: Point, reach: number) {
  let best: { sector: string; wall: string } | null = null;
  let bestDistance = reach;
  const under = sectorAt(map, point);
  for (const [wall, owners] of wallOwners(map)) {
    const [from, to] = wall.split("|");
    const distance = distanceToWall(map, { from, to }, point);
    if (distance > bestDistance + 0.001) continue;
    for (const sector of owners) {
      const inside = sector === under;
      const isTie = Math.abs(distance - bestDistance) < 0.001;
      if (isTie ? inside || !best : distance < bestDistance) {
        best = { sector: sector.id, wall };
        bestDistance = distance;
      }
    }
  }
  return best;
}

// Switch art is one tile wide, so a long wall gets a short section cut out of
// it for the switch instead of repeating the art along its whole length.
export function addSwitch(
  map: GameMap,
  wall: FreeWall,
  point: Point,
  door: string | null = null,
  grid = gridSize,
): { map: GameMap; id: string } {
  const a = map.vertices[wall.from];
  const b = map.vertices[wall.to];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const id = nextId(
    "switch-",
    map.switches.map((item) => item.id),
  );
  const item: MapSwitch = {
    id,
    door,
    sector: wall.sector,
    from: wall.from,
    to: wall.to,
    texture: "SW1STRTN",
  };
  if (length < switchWidth + gridSize * 2) {
    return { id, map: { ...map, switches: [...map.switches, item] } };
  }

  const unit = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const along = Math.max(
    switchWidth / 2 + gridSize,
    Math.min(
      length - switchWidth / 2 - gridSize,
      (point.x - a.x) * unit.x + (point.y - a.y) * unit.y,
    ),
  );
  // The cut stays within the switch's margins, which a coarse grid would
  // carry it past.
  const cornerAt = (distance: number) =>
    snapPoint(
      { x: a.x + unit.x * distance, y: a.y + unit.y * distance },
      Math.min(grid, gridSize),
    );
  const vertices = { ...map.vertices };
  const first = nextId("v", Object.keys(vertices));
  vertices[first] = cornerAt(along - switchWidth / 2);
  const second = nextId("v", Object.keys(vertices));
  vertices[second] = cornerAt(along + switchWidth / 2);
  const key = wallKey(wall.from, wall.to);
  const line = map.lines?.[key];
  const remainder = line && withoutUnset({ ...line, action: undefined });

  return {
    id,
    map: {
      ...map,
      vertices,
      lines: line
        ? withoutUnset({
            ...map.lines,
            [key]: undefined,
            [wallKey(wall.from, first)]: remainder,
            [wallKey(first, second)]: line.action && { action: line.action },
            [wallKey(second, wall.to)]: remainder,
          })
        : map.lines,
      // Every outline along the wall splits with it, so a pillar a room was
      // drawn against keeps the same corners.
      sectors: map.sectors.map((sector) => {
        if (
          !sectorEdges(sector).some(
            (edge) => wallKey(edge.from, edge.to) === key,
          )
        ) {
          return sector;
        }
        const split = (loop: string[]) =>
          loop.flatMap((vertex, index) => {
            const next = loop[(index + 1) % loop.length];
            if (vertex === wall.from && next === wall.to) {
              return [vertex, first, second];
            }
            if (vertex === wall.to && next === wall.from) {
              return [vertex, second, first];
            }
            return [vertex];
          });
        const painted = sector.wallOverrides?.[key];
        return {
          ...sector,
          vertices: split(sector.vertices),
          ...(sector.holes ? { holes: sector.holes.map(split) } : {}),
          wallOverrides: painted
            ? {
                ...sector.wallOverrides,
                [wallKey(wall.from, first)]: painted,
                [wallKey(second, wall.to)]: painted,
              }
            : sector.wallOverrides,
        };
      }),
      switches: [...map.switches, { ...item, from: first, to: second }],
    },
  };
}

export function addSwitchInRoom(
  map: GameMap,
  room: string,
  door: string | null,
) {
  const walls = freeWalls(map).filter(
    (wall) =>
      wall.sector === room && !map.lines?.[wallKey(wall.from, wall.to)]?.action,
  );
  const lengthOf = (wall: FreeWall) => {
    const a = map.vertices[wall.from];
    const b = map.vertices[wall.to];
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const wall = walls.toSorted((a, b) => lengthOf(b) - lengthOf(a))[0];
  if (!wall) return null;
  const a = map.vertices[wall.from];
  const b = map.vertices[wall.to];
  return addSwitch(map, wall, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, door);
}

export function findVertexAt(map: GameMap, point: Point) {
  return Object.entries(map.vertices).find(
    ([, vertex]) => vertex.x === point.x && vertex.y === point.y,
  )?.[0];
}

export function roomDefaults(index: number) {
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
export function addRoom(
  map: GameMap,
  corners: Point[],
  patch: Partial<Omit<Sector, "id" | "vertices">> = {},
  grid = gridSize,
): { map: GameMap; id: string } {
  const vertices = { ...map.vertices };
  const loop = corners.map((corner) => {
    const point = snapPoint(corner, grid);
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

export type RoomSide = "north" | "east" | "south" | "west";

function setLine(map: GameMap, wall: string, line: LineSettings | undefined) {
  return {
    ...map,
    lines: withoutUnset({ ...map.lines, [wall]: line && withoutUnset(line) }),
  };
}

function unusedTag(map: GameMap) {
  const used = new Set([
    ...map.sectors.map((sector) => sector.tag),
    ...Object.values(map.lines ?? {}).map(
      (line) => line.action?.tag ?? line.raw?.tag,
    ),
  ]);
  let tag = 1;
  while (used.has(tag)) tag += 1;
  return tag;
}

const copyOffsets = [
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 0, y: 0 },
];

function copySpot(map: GameMap, thing: Thing) {
  const room = sectorAt(map, thing);
  const spots = copyOffsets.map(({ x, y }) => ({
    x: thing.x + x * gridSize * 2,
    y: thing.y + y * gridSize * 2,
  }));
  return spots.find((spot) => sectorAt(map, spot) === room) ?? spots[0];
}

function freeWalls(map: GameMap): FreeWall[] {
  const owners = wallOwners(map);
  const taken = new Set(
    map.switches.map((item) => wallKey(item.from, item.to)),
  );
  return map.sectors
    .filter((sector) => !sector.door)
    .flatMap((sector) =>
      sectorEdges(sector)
        .filter(({ from, to }) => {
          const key = wallKey(from, to);
          const owning = owners.get(key);
          return (
            owning?.length === 1 && owning[0] === sector && !taken.has(key)
          );
        })
        .map(({ from, to }) => ({ sector: sector.id, from, to })),
    );
}

function distanceToWall(
  map: GameMap,
  wall: { from: string; to: string },
  point: Point,
) {
  const a = map.vertices[wall.from];
  const b = map.vertices[wall.to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

const sideNormals: Record<RoomSide, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

// Builds on the wall facing `side` so the new room is connected through it.
export function addRoomOnSide(
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
    const edges =
      other.id === sector.id
        ? (other.holes ?? []).flatMap(loopEdges)
        : sectorEdges(other);
    for (const edge of edges) {
      taken.set([edge.from, edge.to].toSorted().join("|"), 1);
    }
  }
  for (const item of map.switches) {
    taken.set([item.from, item.to].toSorted().join("|"), 1);
  }

  let best: { from: string; to: string; score: number } | null = null;
  for (const edge of loopEdges(sector.vertices)) {
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

export function roomCenter(map: GameMap, sector: Sector): Point {
  const polygon = sectorPolygon(map, sector);
  const average = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  };
  if (pointInSector(map, sector, average)) return snapPoint(average);
  for (let index = 0; index < polygon.length; index += 1) {
    const before = polygon[index];
    const after = polygon[(index + 2) % polygon.length];
    const middle = { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 };
    if (pointInSector(map, sector, middle)) return snapPoint(middle);
  }
  return snapPoint(polygon[0]);
}

// A new corner on a wall splits it in every outline along it, and both halves
// keep the wall's settings and textures. It lands on the grid where the point
// falls on the wall, which can bend a slanted wall slightly, or with `exact`
// at the point itself, so the wall meets a corner another wall already has.
export function splitWall(
  map: GameMap,
  wall: string,
  point: Point,
  grid = gridSize,
  exact = false,
): { map: GameMap; id: string } | null {
  const [from, to] = wall.split("|");
  const a = map.vertices[from];
  const b = map.vertices[to];
  if (!a || !b) return null;
  if (map.switches.some((item) => wallKey(item.from, item.to) === wall)) {
    return null;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return null;
  const along = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
  );
  const at = exact
    ? { x: Math.round(point.x), y: Math.round(point.y) }
    : snapPoint({ x: a.x + dx * along, y: a.y + dy * along }, grid);
  if ((at.x === a.x && at.y === a.y) || (at.x === b.x && at.y === b.y)) {
    return null;
  }
  const vertices = { ...map.vertices };
  const id = findVertexAt(map, at) ?? nextId("v", Object.keys(vertices));
  vertices[id] = at;
  const split = (chain: string[], closed: boolean) =>
    chain.flatMap((vertex, index) => {
      if (!closed && index === chain.length - 1) return [vertex];
      const next = chain[(index + 1) % chain.length];
      return (vertex === from && next === to) ||
        (vertex === to && next === from)
        ? [vertex, id]
        : [vertex];
    });
  const halves = [wallKey(from, id), wallKey(id, to)];
  const line = map.lines?.[wall];
  // A texture runs on along a room's second half from where its first half
  // ends, so the picture stays whole across the new corner.
  const firstLength = (start: string) =>
    Math.round(
      Math.hypot(at.x - map.vertices[start].x, at.y - map.vertices[start].y),
    );
  // The room around a nested room has no edge of its own on their shared
  // wall, and reads it from the other end.
  const owners = wallOwners(map).get(wall) ?? [];
  const startFor = (sectorId: string) => {
    const sector = owners.find((item) => item.id === sectorId);
    const own = sector && wallStart(map, sector, wall);
    if (own) return own;
    const other = owners.find((item) => item.id !== sectorId);
    const theirs = other && wallStart(map, other, wall);
    return theirs ? (theirs === from ? to : from) : from;
  };
  const sidesFor = (half: number) =>
    line?.sides &&
    Object.fromEntries(
      Object.entries(line.sides).map(([sectorId, side]) => {
        const start = startFor(sectorId);
        const first = start === from ? 0 : 1;
        return [
          sectorId,
          half === first
            ? side
            : { ...side, offsetX: (side.offsetX ?? 0) + firstLength(start) },
        ];
      }),
    );
  const halfLine = (half: number) =>
    line && withoutUnset({ ...line, sides: sidesFor(half) });
  return {
    id,
    map: {
      ...map,
      vertices,
      sectors: map.sectors.map((sector) => {
        if (
          !sectorEdges(sector).some(
            (edge) => wallKey(edge.from, edge.to) === wall,
          )
        ) {
          return sector;
        }
        const painted = sector.wallOverrides?.[wall];
        return {
          ...sector,
          vertices: split(sector.vertices, true),
          ...(sector.holes
            ? { holes: sector.holes.map((hole) => split(hole, true)) }
            : {}),
          ...(sector.details
            ? { details: sector.details.map((chain) => split(chain, false)) }
            : {}),
          ...(painted
            ? {
                wallOverrides: withoutUnset({
                  ...sector.wallOverrides,
                  [wall]: undefined,
                  [halves[0]]: painted,
                  [halves[1]]: painted,
                }),
              }
            : {}),
        };
      }),
      lines: line
        ? withoutUnset({
            ...map.lines,
            [wall]: undefined,
            [halves[0]]: halfLine(0),
            [halves[1]]: halfLine(1),
          })
        : map.lines,
    },
  };
}

// Joins each of these corners to a corner it sits on. The corners that stay
// put are filed by their spot once, so a big selection costs a lookup a corner
// and not a pass over the map.
export function mergeCorners(map: GameMap, ids: string[]): GameMap {
  const moved = new Set(ids);
  const spots = new Map<string, string[]>();
  for (const [id, point] of Object.entries(map.vertices)) {
    if (moved.has(id)) continue;
    const spot = `${point.x},${point.y}`;
    const held = spots.get(spot);
    if (held) held.push(id);
    else spots.set(spot, [id]);
  }
  let next = map;
  for (const id of ids) {
    const point = next.vertices[id];
    if (!point) continue;
    const target = spots
      .get(`${point.x},${point.y}`)
      ?.find((other) => next.vertices[other]);
    if (target && getCanJoin(next, id, target)) {
      next = replaceCorner(next, id, target);
    }
  }
  return next;
}

// Takes a room out of the one around it and leaves its shape as solid wall.
export function makePillar(map: GameMap, id: string): GameMap | null {
  const sector = map.sectors.find((item) => item.id === id);
  const container = sector && containerOf(map, sector);
  if (!sector || !container || sector.door) return null;
  if (sector.holes?.length || sector.details?.length) return null;
  const sectors = map.sectors
    .filter((item) => item.id !== id)
    .map((item) =>
      item.id === container.id
        ? withHoles(item, [...(item.holes ?? []), sector.vertices])
        : item,
    );
  return pruneUnused(
    pruneLines(
      {
        ...map,
        sectors,
        switches: map.switches
          .filter((item) => item.sector !== id)
          .map((item) => (item.door === id ? { ...item, door: null } : item)),
      },
      id,
    ),
  );
}

// Turns a pillar back into a room that matches the one around it.
export function fillHole(
  map: GameMap,
  id: string,
  index: number,
): { map: GameMap; id: string } | null {
  const sector = map.sectors.find((item) => item.id === id);
  const hole = sector?.holes?.[index];
  if (!sector || !hole) return null;
  const roomId = nextId(
    "sector-",
    map.sectors.map((item) => item.id),
  );
  return {
    id: roomId,
    map: {
      ...map,
      sectors: [
        ...map.sectors.map((item) =>
          item.id === id
            ? withHoles(
                item,
                defined(sector.holes).filter((_, at) => at !== index),
              )
            : item,
        ),
        {
          id: roomId,
          vertices: hole,
          ...roomDefaults(map.sectors.length + 1),
          floor: sector.floor,
          ceiling: sector.ceiling,
          light: sector.light,
          floorTexture: sector.floorTexture,
          ceilingTexture: sector.ceilingTexture,
          wallTexture: sector.wallTexture,
        },
      ],
    },
  };
}

// A line drawn inside a room, with the room on both of its sides, for a
// middle texture or a walk-over action. Every stretch of it must cross that
// room's floor.
export function addDetail(
  map: GameMap,
  points: Point[],
  grid = gridSize,
): { map: GameMap; id: string } | null {
  const chain = points
    .map((point) => snapPoint(point, grid))
    .filter(
      (point, index, list) =>
        index === 0 ||
        point.x !== list[index - 1].x ||
        point.y !== list[index - 1].y,
    );
  if (chain.length < 2) return null;
  const owner = sectorAt(map, middle(chain[0], chain[1]));
  if (!owner || owner.door) return null;
  const strays = chain
    .slice(1)
    .some(
      (point, index) => sectorAt(map, middle(chain[index], point)) !== owner,
    );
  if (strays) return null;
  const vertices = { ...map.vertices };
  const corners = chain.map((point) => {
    const existing = findVertexAt({ ...map, vertices }, point);
    if (existing) return existing;
    const id = nextId("v", Object.keys(vertices));
    vertices[id] = point;
    return id;
  });
  const walls = wallOwners(map);
  if (
    corners.slice(1).some((to, index) => walls.has(wallKey(corners[index], to)))
  ) {
    return null;
  }
  return {
    id: owner.id,
    map: {
      ...map,
      vertices,
      sectors: map.sectors.map((sector) =>
        sector.id === owner.id
          ? { ...sector, details: [...(sector.details ?? []), corners] }
          : sector,
      ),
    },
  };
}

// Takes one line out of a chain and keeps what is left on either side of it.
export function removeDetailLine(
  map: GameMap,
  id: string,
  wall: string,
): GameMap {
  return pruneUnused({
    ...map,
    sectors: map.sectors.map((sector) => {
      if (sector.id !== id || !sector.details) return sector;
      const details = sector.details.flatMap((chain) => {
        const at = chain.findIndex(
          (vertex, index) =>
            index > 0 && wallKey(chain[index - 1], vertex) === wall,
        );
        if (at < 0) return [chain];
        return [chain.slice(0, at), chain.slice(at)].filter(
          (part) => part.length >= 2,
        );
      });
      return withDetails(sector, details);
    }),
  });
}

// The engine works a switch or a teleporter on a line from its front, the
// right-hand side of the direction it was drawn in. The rest of its chain
// keeps facing the way it was.
export function flipDetailLine(
  map: GameMap,
  id: string,
  wall: string,
): GameMap {
  return {
    ...map,
    sectors: map.sectors.map((sector) =>
      sector.id === id && sector.details
        ? {
            ...sector,
            details: sector.details.flatMap((chain) => {
              const at = chain.findIndex(
                (vertex, index) =>
                  index > 0 && wallKey(chain[index - 1], vertex) === wall,
              );
              if (at < 0) return [chain];
              return [
                chain.slice(0, at),
                [chain[at], chain[at - 1]],
                chain.slice(at),
              ].filter((part) => part.length >= 2);
            }),
          }
        : sector,
    ),
  };
}

export function removeHole(map: GameMap, id: string, index: number): GameMap {
  return pruneUnused({
    ...map,
    sectors: map.sectors.map((sector) =>
      sector.id === id && sector.holes
        ? withHoles(
            sector,
            sector.holes.filter((_, at) => at !== index),
          )
        : sector,
    ),
  });
}

export function nextId(prefix: string, used: Iterable<string>) {
  let highest = 0;
  for (const id of used) {
    if (id.startsWith(prefix)) {
      highest = Math.max(highest, Number(id.slice(prefix.length)) || 0);
    }
  }
  return `${prefix}${highest + 1}`;
}

function withoutUnset<T extends object>(value: T) {
  const entries = Object.entries(value).filter(
    ([, item]) => item !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Defined<T>)
    : undefined;
}

function pruneLines(map: GameMap, removed?: string): GameMap {
  const owners = wallOwners(map);
  const lines: Record<string, LineSettings | undefined> = {};
  for (const [wall, line] of Object.entries(map.lines ?? {})) {
    if (!owners.has(wall)) continue;
    const sides = {
      ...line.sides,
      ...(removed ? { [removed]: undefined } : {}),
    };
    lines[wall] = withoutUnset({
      ...line,
      sides: withoutUnset(sides),
      front: line.front === removed ? undefined : line.front,
    });
  }
  return { ...map, lines: withoutUnset(lines) };
}

function middle(a: Point, b: Point) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Corners no outline uses any more go, and so do the switches and settings
// on the walls that went with them.
function pruneUnused(map: GameMap): GameMap {
  const used = new Set(map.sectors.flatMap(sectorVertices));
  const pruned = {
    ...map,
    vertices: Object.fromEntries(
      Object.entries(map.vertices).filter(([vertex]) => used.has(vertex)),
    ),
  };
  const owners = wallOwners(pruned);
  return pruneLines({
    ...pruned,
    switches: map.switches.filter((item) =>
      owners.has(wallKey(item.from, item.to)),
    ),
  });
}

// Two corners of one outline can only join when they sit side by side, or
// the outline would run through a corner twice.
function getCanJoin(map: GameMap, from: string, to: string) {
  return map.sectors.every((sector) =>
    [
      ...sectorLoops(sector).map((loop) => ({ loop, closed: true })),
      ...(sector.details ?? []).map((loop) => ({ loop, closed: false })),
    ].every(({ loop, closed }) => {
      const a = loop.indexOf(from);
      const b = loop.indexOf(to);
      if (a < 0 || b < 0) return true;
      const apart = Math.abs(a - b);
      return apart === 1 || (closed && apart === loop.length - 1);
    }),
  );
}

// Every use of one corner moves to another, so walls join up and a wall that
// ran between the two goes away.
function replaceCorner(map: GameMap, from: string, to: string): GameMap {
  const rename = (id: string) => (id === from ? to : id);
  const holds = (key: string) => key.split("|").includes(from);
  const rekey = <T>(record: Record<string, T> | undefined) => {
    if (!record) return undefined;
    const out: Record<string, T> = {};
    const entries = Object.entries(record).toSorted(
      ([a], [b]) => Number(holds(a)) - Number(holds(b)),
    );
    for (const [key, value] of entries) {
      const [first, second] = key.split("|").map(rename);
      const renamed = wallKey(first, second);
      if (first !== second && !(renamed in out)) out[renamed] = value;
    }
    return withoutUnset(out);
  };
  const vertices = { ...map.vertices };
  delete vertices[from];
  return pruneUnused({
    ...map,
    vertices,
    sectors: map.sectors.map((sector) => {
      const next: Sector = {
        ...sector,
        vertices: closedChain(sector.vertices.map(rename)),
      };
      if (sector.holes) {
        next.holes = sector.holes.map((hole) => closedChain(hole.map(rename)));
      }
      if (sector.details) {
        const details = sector.details
          .map((chain) => openChain(chain.map(rename)))
          .filter((chain) => chain.length >= 2);
        if (details.length > 0) next.details = details;
        else delete next.details;
      }
      const overrides = rekey(sector.wallOverrides);
      if (overrides) next.wallOverrides = overrides;
      else delete next.wallOverrides;
      return next;
    }),
    lines: rekey(map.lines),
    switches: map.switches
      .map((item) => ({
        ...item,
        from: rename(item.from),
        to: rename(item.to),
      }))
      .filter((item) => item.from !== item.to),
  });
}

function closedChain(chain: string[]) {
  return chain.filter((id, index) => id !== chain[(index + 1) % chain.length]);
}

function openChain(chain: string[]) {
  return chain.filter((id, index) => index === 0 || id !== chain[index - 1]);
}

function withHoles(sector: Sector, holes: string[][]): Sector {
  const next: Sector = { ...sector, holes };
  if (holes.length === 0) delete next.holes;
  return next;
}

function withDetails(sector: Sector, details: string[][]): Sector {
  const next: Sector = { ...sector, details };
  if (details.length === 0) delete next.details;
  return next;
}
