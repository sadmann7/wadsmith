import { isPlayerStart } from "./catalog";
import {
  containerOf,
  loopEdges,
  pointInSector,
  sectorAt,
  sectorEdges,
  sectorPolygon,
  sectorVertices,
  signedArea,
  wallKey,
  wallOwners,
} from "./geometry";
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

const gridSize = 8;
const thingKeyPrefix = "thing:";
const switchKeyPrefix = "switch:";
const doorKeyPrefix = "door:";
const switchWidth = 64;

const defaultDoor: DoorSettings = {
  opensBy: "use",
  closes: true,
  texture: "BIGDOOR2",
};

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

const positionCache = new WeakMap<GameMap, Record<string, Point>>();
const thingPoints = new WeakMap<Thing, Point>();

// The editor reads positions from its map on every render, and a fresh object
// would count as a change that wakes every part on the canvas.
function positionsOf(map: GameMap): Record<string, Point> {
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
    things: map.things.map((thing) => {
      const at = positions[`${thingKeyPrefix}${thing.id}`];
      return !at || (at.x === thing.x && at.y === thing.y)
        ? thing
        : { ...thing, x: at.x, y: at.y };
    }),
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
function addPlayerStarts(map: GameMap, players: number) {
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

function addThing(
  map: GameMap,
  kind: ThingKind,
  point: Point,
  angle = 0,
): { map: GameMap; id: string } {
  const at = snapPoint(point);
  const things = isPlayerStart(kind)
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

function removeThing(map: GameMap, id: string): GameMap {
  return { ...map, things: map.things.filter((thing) => thing.id !== id) };
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

function withoutUnset<T extends object>(value: T) {
  const entries = Object.entries(value).filter(
    ([, item]) => item !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Defined<T>)
    : undefined;
}

function setLine(map: GameMap, wall: string, line: LineSettings | undefined) {
  return {
    ...map,
    lines: withoutUnset({ ...map.lines, [wall]: line && withoutUnset(line) }),
  };
}

function updateLine(
  map: GameMap,
  wall: string,
  patch: Partial<Omit<LineSettings, "sides">>,
): GameMap {
  return setLine(map, wall, { ...map.lines?.[wall], ...patch });
}

function updateLineSide(
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

function unusedTag(map: GameMap) {
  const used = new Set([
    ...map.sectors.map((sector) => sector.tag),
    ...Object.values(map.lines ?? {}).map((line) => line.action?.tag),
  ]);
  let tag = 1;
  while (used.has(tag)) tag += 1;
  return tag;
}

function setLineTarget(
  map: GameMap,
  wall: string,
  sectorId: string | null,
): GameMap {
  const action = map.lines?.[wall]?.action;
  if (!action) return map;
  const sector = map.sectors.find((item) => item.id === sectorId);
  if (!sector) return updateLine(map, wall, { action: { ...action, tag: 0 } });
  const tag = sector.tag || unusedTag(map);
  return updateLine(updateSector(map, sector.id, { tag }), wall, {
    action: { ...action, tag },
  });
}

function setRoomWalls(map: GameMap, id: string, wallTexture: string): GameMap {
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

function addNote(map: GameMap, point: Point, text: string): GameMap {
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

function removeNote(map: GameMap, id: string): GameMap {
  const notes = map.notes?.filter((note) => note.id !== id);
  return { ...map, notes: notes?.length ? notes : undefined };
}

function removeThings(map: GameMap, ids: string[]) {
  return ids.reduce(removeThing, map);
}

function changeThings(map: GameMap, ids: string[], kind: ThingKind) {
  return ids.reduce((next, id) => updateThing(next, id, { kind }), map);
}

function updateThings(
  map: GameMap,
  ids: string[],
  patch: (thing: Thing) => Partial<Omit<Thing, "id">>,
) {
  return ids.reduce((next, id) => {
    const thing = next.things.find((item) => item.id === id);
    return thing ? updateThing(next, id, patch(thing)) : next;
  }, map);
}

function faceThings(map: GameMap, ids: string[], angle: number) {
  return ids.reduce((next, id) => updateThing(next, id, { angle }), map);
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

// A second player start would replace the first, so it is never copied.
function duplicateThings(map: GameMap, ids: string[]) {
  let next = map;
  const copies: string[] = [];
  for (const id of ids) {
    const thing = map.things.find((item) => item.id === id);
    if (!thing || isPlayerStart(thing.kind)) continue;
    const added = addThing(next, thing.kind, copySpot(map, thing), thing.angle);
    next = updateThing(added.map, added.id, {
      skills: thing.skills,
      ambush: thing.ambush,
    });
    copies.push(added.id);
  }
  return { map: next, ids: copies };
}

function snapCorners(map: GameMap, ids: string[]): GameMap {
  const vertices = { ...map.vertices };
  for (const id of ids) {
    if (vertices[id]) vertices[id] = snapPoint(vertices[id]);
  }
  return { ...map, vertices };
}

function connectedCorners(map: GameMap, ids: string[]) {
  const rooms = map.sectors.filter((sector) =>
    sectorVertices(sector).some((vertex) => ids.includes(vertex)),
  );
  return [...new Set(rooms.flatMap(sectorVertices))];
}

function removeSector(map: GameMap, id: string): GameMap {
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

function setRoomDoor(
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

function updateSwitch(
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

function removeSwitch(map: GameMap, id: string): GameMap {
  return {
    ...map,
    switches: map.switches.filter((item) => item.id !== id),
  };
}

type FreeWall = { sector: string; from: string; to: string };

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

function freeWallAt(map: GameMap, wall: string) {
  return (
    freeWalls(map).find((item) => wallKey(item.from, item.to) === wall) ?? null
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

function freeWallNear(map: GameMap, point: Point, reach: number) {
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
function wallNear(map: GameMap, point: Point, reach: number) {
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
function addSwitch(
  map: GameMap,
  wall: FreeWall,
  point: Point,
  door: string | null = null,
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
  const cornerAt = (distance: number) =>
    snapPoint({ x: a.x + unit.x * distance, y: a.y + unit.y * distance });
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

function addSwitchInRoom(map: GameMap, room: string, door: string | null) {
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

function roomCenter(map: GameMap, sector: Sector): Point {
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

function withHoles(sector: Sector, holes: string[][]): Sector {
  const next: Sector = { ...sector, holes };
  if (holes.length === 0) delete next.holes;
  return next;
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

// Takes a room out of the one around it and leaves its shape as solid wall.
function makePillar(map: GameMap, id: string): GameMap | null {
  const sector = map.sectors.find((item) => item.id === id);
  const container = sector && containerOf(map, sector);
  if (!sector || !container || sector.door || sector.holes?.length) return null;
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
function fillHole(
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
                sector.holes!.filter((_, at) => at !== index),
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

function removeHole(map: GameMap, id: string, index: number): GameMap {
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

export {
  addNote,
  addPlayerStarts,
  addRoom,
  addRoomOnSide,
  addSwitch,
  addSwitchInRoom,
  addThing,
  applyPositions,
  changeThings,
  connectedCorners,
  defaultDoor,
  doorKeyPrefix,
  duplicateThings,
  faceThings,
  fillHole,
  findVertexAt,
  freeWallAt,
  freeWallNear,
  gridSize,
  makePillar,
  positionsOf,
  removeHole,
  removeNote,
  removeSector,
  removeSwitch,
  removeThing,
  removeThings,
  roomCenter,
  roomDefaults,
  setLineTarget,
  setRoomDoor,
  setRoomWalls,
  snap,
  snapCorners,
  snapPoint,
  switchKeyPrefix,
  thingKeyPrefix,
  updateLine,
  updateLineSide,
  updateSector,
  updateSwitch,
  updateThing,
  updateThings,
  wallNear,
  type RoomSide,
};
