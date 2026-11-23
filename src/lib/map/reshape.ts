import { defined } from "@/lib/defined";

import type { Edge } from "./geometry";
import type { GameMap, LineSettings, LineSide, Point, Sector } from "./types";

import {
  addRoom,
  findVertexAt,
  gridSize,
  nextId,
  pruneUnused,
  roomDefaults,
  snapPoint,
  splitWall,
} from "./edit";
import {
  containerOf,
  cross,
  loopEdges,
  loopPolygon,
  pointInPolygon,
  pointInSector,
  sectorAt,
  sectorEdges,
  sectorLoops,
  sectorPolygon,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
  wallStart,
} from "./geometry";
import { crossing, getIsWithin, joinWalls } from "./join";

interface Cycle {
  loop: string[];
  polygon: Point[];
  area: number;
}

interface Piece extends Cycle {
  source: Sector;
  point: Point;
  holes: string[][];
}

interface RebuiltRoom {
  id: string;
  source: string;
  point: Point;
  area: number;
}

interface Rebuilt {
  map: GameMap;
  rooms: RebuiltRoom[];
}

interface RebuildOptions {
  add?: Edge[];
  keep?: string[];
  remove?: Set<string>;
  merge?: boolean;
  weak?: string;
}

// Draws a line over the map the way a desktop editor does. A stretch from
// one wall of a room to another splits it; one that doesn't becomes a line
// in the room, or in split mode makes the whole draw null. Null too when no
// part of the line lands in a room, or it meets a switch's wall.
export function drawLines(
  map: GameMap,
  points: Point[],
  grid = gridSize,
  mode: "draw" | "split" = "draw",
): { map: GameMap; rooms: string[] } | null {
  const snapped = points
    .map((point) => snapPoint(point, grid))
    .filter(
      (point, index, list) =>
        index === 0 ||
        point.x !== list[index - 1].x ||
        point.y !== list[index - 1].y,
    );
  if (snapped.length < 2) return null;

  let next = map;
  const chain: string[] = [];
  for (const point of nodedPoints(map, snapped)) {
    let id = findVertexAt(next, point);
    if (!id) {
      const wall = wallThrough(next, point);
      if (wall) {
        // A wall with a switch on it stays whole, so nothing can join it.
        const split = splitWall(next, wall, point, 1, true);
        if (!split) return null;
        next = split.map;
        id = split.id;
      }
    }
    if (!id) {
      id = nextId("v", Object.keys(next.vertices));
      next = { ...next, vertices: { ...next.vertices, [id]: point } };
    }
    if (chain.at(-1) !== id) chain.push(id);
  }
  if (chain.length < 2) return null;

  const anchors = loopCorners(next);
  const stops = chain.flatMap((id, index) => (anchors.has(id) ? [index] : []));
  const runs: { corners: string[]; closed: boolean }[] = [];
  if (stops.length === 0) {
    runs.push({ corners: chain, closed: false });
  } else {
    if (stops[0] > 0) {
      runs.push({ corners: chain.slice(0, stops[0] + 1), closed: false });
    }
    for (const [at, stop] of stops.slice(1).entries()) {
      runs.push({ corners: chain.slice(stops[at], stop + 1), closed: true });
    }
    const last = defined(stops.at(-1));
    if (last < chain.length - 1) {
      runs.push({ corners: chain.slice(last), closed: false });
    }
  }

  // Each room takes every stretch that crosses it at once, so a line that
  // runs past a room drawn inside it still cuts it in two.
  const walls = allWalls(next);
  const byRoom = new Map<Sector, { corners: string[]; closed: boolean }[]>();
  for (const run of runs) {
    const edges = run.corners
      .slice(1)
      .map((to, index) => ({ from: run.corners[index], to }));
    if (edges.length === 0) continue;
    if (edges.some(({ from, to }) => walls.has(wallKey(from, to)))) continue;
    const holders = edges.map(({ from, to }) =>
      sectorAt(next, midpoint(next.vertices[from], next.vertices[to])),
    );
    const room = holders[0];
    if (!room || room.door || holders.some((item) => item !== room)) continue;
    byRoom.set(room, [...(byRoom.get(room) ?? []), run]);
  }

  const touched: string[] = [];
  let changed = false;
  for (const [room, list] of byRoom) {
    const inside = next.sectors.filter(
      (sector) => containerOf(next, sector)?.id === room.id,
    );
    const ends = new Set(
      [room, ...inside].flatMap((sector) => sectorLoops(sector).flat()),
    );
    const cuts = list.filter(
      ({ corners, closed }) =>
        closed && ends.has(corners[0]) && ends.has(defined(corners.at(-1))),
    );
    let lines = list;
    if (cuts.length > 0) {
      const split = (chains: string[][]) => {
        const rebuilt = rebuildRooms(next, [room.id], {
          add: chains.flatMap((chain) =>
            chain.slice(1).map((to, index) => ({ from: chain[index], to })),
          ),
          keep: inside.map((sector) => sector.id),
        });
        return rebuilt && rebuilt.rooms.length > 1 ? rebuilt : null;
      };
      const drawn = cuts.map(({ corners }) => corners);
      // A line drawn earlier from wall to wall may close a piece off with it.
      const spokes = (room.details ?? []).filter(
        (chain) => ends.has(chain[0]) && ends.has(defined(chain.at(-1))),
      );
      const rebuilt =
        (spokes.length > 0 && split([...drawn, ...spokes])) || split(drawn);
      if (rebuilt) {
        next = rebuilt.map;
        touched.push(...rebuilt.rooms.map((item) => item.id));
        changed = true;
        lines = list.filter((run) => !cuts.includes(run));
      }
    }
    if (mode === "split" && lines.length > 0) return null;
    for (const { corners } of lines) {
      const holder = sectorAt(
        next,
        midpoint(next.vertices[corners[0]], next.vertices[corners[1]]),
      );
      if (!holder) continue;
      next = {
        ...next,
        sectors: next.sectors.map((sector) =>
          sector.id === holder.id
            ? { ...sector, details: [...(sector.details ?? []), corners] }
            : sector,
        ),
      };
      touched.push(holder.id);
      changed = true;
    }
  }
  if (!changed) return null;
  const done = pruneUnused(next);
  const ids = new Set(done.sectors.map((sector) => sector.id));
  return {
    map: done,
    rooms: [...new Set(touched)].filter((id) => ids.has(id)),
  };
}

// Draws a room over the map, sharing corners with the walls it meets. Where
// it lies over part of another room the two cut each other up, the overlap
// staying the old room. The id is the new room's, or if old rooms cover it
// all, the one covering most of it.
export function drawRoom(
  map: GameMap,
  corners: Point[],
  patch: Partial<Omit<Sector, "id" | "vertices">> = {},
  grid = gridSize,
): { map: GameMap; id: string } {
  const added = addRoom(map, corners, patch, grid);
  const joined = joinWalls(added.map, [added.id]);
  const drawn = joined.sectors.find((sector) => sector.id === added.id);
  if (!drawn) return { map: joined, id: added.id };
  const crossed = joined.sectors.filter(
    (sector) => sector !== drawn && getIsCrossing(joined, drawn, sector),
  );
  if (
    crossed.length === 0 ||
    crossed.some(
      (sector) => sector.door || getIsOverPillar(joined, drawn, sector),
    )
  ) {
    return { map: joined, id: added.id };
  }
  const outline = sectorPolygon(joined, drawn);
  const covered = joined.sectors.filter(
    (sector) =>
      sector !== drawn &&
      !crossed.includes(sector) &&
      loopEdges(sector.vertices).some(({ from, to }) =>
        pointInPolygon(
          midpoint(joined.vertices[from], joined.vertices[to]),
          outline,
        ),
      ),
  );
  const rebuilt = rebuildRooms(
    joined,
    [drawn.id, ...crossed.map((sector) => sector.id)],
    { weak: drawn.id, keep: covered.map((sector) => sector.id) },
  );
  if (!rebuilt) return { map: joined, id: added.id };
  const covering =
    rebuilt.rooms.find((room) => room.id === drawn.id) ??
    rebuilt.rooms
      .filter((room) => pointInPolygon(room.point, outline))
      .toSorted((a, b) => b.area - a.area)[0];
  return { map: pruneUnused(rebuilt.map), id: covering?.id ?? added.id };
}

// Joins rooms that share walls into one with the first room's floor,
// ceiling and light, taking out the walls between them. Each wall keeps the
// texture it showed. Null unless every room touches another along a wall,
// none sits inside another, and they don't carry different tags.
export function joinRooms(
  map: GameMap,
  ids: string[],
): { map: GameMap; id: string } | null {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return null;
  const seen = new Map<string, number>();
  for (const id of unique) {
    const room = map.sectors.find((sector) => sector.id === id);
    if (!room) return null;
    for (const { from, to } of loopEdges(room.vertices)) {
      const key = wallKey(from, to);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const shared = new Set(
    [...seen].filter(([, count]) => count > 1).map(([key]) => key),
  );
  if (shared.size === 0) return null;
  // A room inside another shares its outer walls without being beside it.
  if (
    unique.some((id) => {
      const room = map.sectors.find((sector) => sector.id === id);
      const container = room && containerOf(map, room);
      return container && unique.includes(container.id);
    })
  ) {
    return null;
  }
  // A tag is how actions find a room, so rooms tagged differently stay apart.
  const tags = new Set(
    unique.flatMap(
      (id) => map.sectors.find((sector) => sector.id === id)?.tag || [],
    ),
  );
  if (tags.size > 1) return null;
  const rebuilt = rebuildRooms(map, unique, { remove: shared, merge: true });
  if (!rebuilt || rebuilt.rooms.length !== 1) return null;
  const id = rebuilt.rooms[0].id;
  const [tag] = tags;
  const tagged = tag
    ? {
        ...rebuilt.map,
        sectors: rebuilt.map.sectors.map((sector) =>
          sector.id === id ? { ...sector, tag } : sector,
        ),
      }
    : rebuilt.map;
  return { map: pruneUnused(tagged), id };
}

// Takes a corner out, joining the two walls that met there into one. Null
// when more than two walls meet there, a switch hangs on one of them, both
// carry an action, the joined wall would cross another or cut off another
// corner, or a room would be left with fewer than three corners.
export function removeCorner(map: GameMap, id: string): GameMap | null {
  if (!map.vertices[id]) return null;
  if (map.switches.some((item) => item.from === id || item.to === id)) {
    return null;
  }
  const neighbors = new Set<string>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      if (from === id) neighbors.add(to);
      if (to === id) neighbors.add(from);
    }
  }
  if (neighbors.size === 0 || neighbors.size > 2) return null;
  const [a, b] = [...neighbors];
  const joined = b === undefined ? null : wallKey(a, b);
  if (joined && allWalls(map).has(joined)) return null;
  const halves = b === undefined ? [] : [wallKey(a, id), wallKey(id, b)];
  if (joined) {
    const walls = allWalls(map);
    if (
      [...walls.keys()].some(
        (wall) => !halves.includes(wall) && getDoWallsMeet(map, joined, wall),
      )
    ) {
      return null;
    }
    // The corner's triangle changes rooms, so nothing else may sit in it.
    const triangle = [map.vertices[a], map.vertices[id], map.vertices[b]];
    if (
      Object.entries(map.vertices).some(
        ([corner, point]) =>
          corner !== a &&
          corner !== b &&
          corner !== id &&
          pointInPolygon(point, triangle),
      )
    ) {
      return null;
    }
  }
  // The half a room's texture starts on keeps its offsets, so the picture
  // stays where it was along the joined wall.
  const firstHalf = (sectorId: string) => {
    const sector = map.sectors.find((item) => item.id === sectorId);
    const start = sector && wallStart(map, sector, halves[0]);
    return start === id ? 1 : 0;
  };
  const halfLength = (half: number) => {
    const [from, to] = halves[half].split("|");
    const p = map.vertices[from];
    const q = map.vertices[to];
    return Math.round(Math.hypot(q.x - p.x, q.y - p.y));
  };
  let lines = map.lines;
  const pair = halves.map((key) => map.lines?.[key]);
  if (joined && (pair[0] || pair[1])) {
    const [first, second] = pair;
    if ((first?.action ?? first?.raw) && (second?.action ?? second?.raw)) {
      return null;
    }
    const line: LineSettings = { ...second, ...first };
    delete line.sides;
    const sides: Record<string, LineSide> = {};
    for (const sectorId of new Set([
      ...Object.keys(first?.sides ?? {}),
      ...Object.keys(second?.sides ?? {}),
    ])) {
      const start = firstHalf(sectorId);
      const own = pair[start]?.sides?.[sectorId];
      const later = pair[1 - start]?.sides?.[sectorId];
      if (own) sides[sectorId] = own;
      else if (later) {
        sides[sectorId] = {
          ...later,
          offsetX: (later.offsetX ?? 0) - halfLength(start),
        };
      }
    }
    if (Object.keys(sides).length > 0) line.sides = sides;
    lines = { ...map.lines, [joined]: line };
    delete lines[halves[0]];
    delete lines[halves[1]];
  }
  const merged = (sector: Sector) => {
    const record = sector.wallOverrides;
    if (!record || !halves.some((key) => key in record)) return record;
    const out = { ...record };
    const start = firstHalf(sector.id);
    const kept = out[halves[start]] ?? out[halves[1 - start]];
    delete out[halves[0]];
    delete out[halves[1]];
    if (joined && kept !== undefined) out[joined] = kept;
    return out;
  };
  const sectors: Sector[] = [];
  for (const sector of map.sectors) {
    if (!sectorEdges(sector).some(({ from, to }) => from === id || to === id)) {
      sectors.push(sector);
      continue;
    }
    const loops = sectorLoops(sector).map((loop) =>
      loop.filter((corner) => corner !== id),
    );
    if (
      loops.some(
        (loop) => loop.length < 3 || signedArea(loopPolygon(map, loop)) === 0,
      )
    ) {
      return null;
    }
    const next: Sector = { ...sector, vertices: loops[0] };
    if (sector.holes) next.holes = loops.slice(1);
    if (sector.details) {
      const details = sector.details
        .map((chain) => chain.filter((corner) => corner !== id))
        .filter((chain) => chain.length >= 2);
      if (details.length > 0) next.details = details;
      else delete next.details;
    }
    const overrides = merged(sector);
    if (overrides && Object.keys(overrides).length > 0) {
      next.wallOverrides = overrides;
    } else delete next.wallOverrides;
    sectors.push(next);
  }
  const vertices = { ...map.vertices };
  delete vertices[id];
  return pruneUnused({
    ...map,
    vertices,
    sectors,
    ...(lines ? { lines } : {}),
  });
}

// Corners dropped on the middle of a wall become corners of that wall, and
// corners a moved wall now runs over become corners of the moved wall, so
// walls laid along each other join.
export function joinCornersToWalls(map: GameMap, ids: string[]): GameMap {
  let next = map;
  const moved = new Set(ids);
  // Puts a corner into a wall, unless a room along the wall already runs
  // through that corner, which would visit it twice.
  const place = (corner: string, wall: string) => {
    const point = next.vertices[corner];
    const alongside = next.sectors.some(
      (sector) =>
        sectorEdges(sector).some(
          (edge) => wallKey(edge.from, edge.to) === wall,
        ) &&
        [...sectorLoops(sector), ...(sector.details ?? [])].some((loop) =>
          loop.includes(corner),
        ),
    );
    if (alongside) return false;
    const split = splitWall(next, wall, point, 1, true);
    if (!split || split.id !== corner) return false;
    next = split.map;
    return true;
  };
  for (const id of ids) {
    const point = next.vertices[id];
    if (!point) continue;
    for (const [key, { from, to }] of allWalls(next)) {
      if (from === id || to === id) continue;
      if (
        getIsWithin(next.vertices[from], next.vertices[to], point) &&
        place(id, key)
      ) {
        break;
      }
    }
  }
  for (let round = 0; round < mostJoins; round += 1) {
    let joined = false;
    for (const [key, { from, to }] of allWalls(next)) {
      if (!moved.has(from) && !moved.has(to)) continue;
      const a = next.vertices[from];
      const b = next.vertices[to];
      const corner = Object.keys(next.vertices).find(
        (other) =>
          other !== from &&
          other !== to &&
          getIsWithin(a, b, next.vertices[other]) &&
          place(other, key),
      );
      if (corner) {
        joined = true;
        break;
      }
    }
    if (!joined) break;
  }
  return next;
}

const mostJoins = 64;

// Where a drawn polyline meets the walls already there, in order along it:
// corners it passes through, and points where it crosses a wall.
function nodedPoints(map: GameMap, points: Point[]) {
  const walls = [...allWalls(map).values()].map(({ from, to }) => ({
    a: map.vertices[from],
    b: map.vertices[to],
  }));
  const out: Point[] = [];
  const push = (point: Point) => {
    const last = out.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) out.push(point);
  };
  for (const [at, q] of points.slice(1).entries()) {
    const p = points[at];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = dx * dx + dy * dy;
    const stops: { t: number; point: Point }[] = [
      { t: 0, point: p },
      { t: 1, point: q },
    ];
    const along = (point: Point) =>
      ((point.x - p.x) * dx + (point.y - p.y) * dy) / length;
    for (const { a, b } of walls) {
      for (const end of [a, b]) {
        if (getIsWithin(p, q, end)) stops.push({ t: along(end), point: end });
      }
      const met = crossing(p, q, a, b);
      if (met) stops.push({ t: along(met), point: met });
    }
    stops.sort((first, second) => first.t - second.t);
    for (const { point } of stops) push(point);
  }
  return out;
}

function wallThrough(map: GameMap, point: Point) {
  for (const [key, { from, to }] of allWalls(map)) {
    if (getIsWithin(map.vertices[from], map.vertices[to], point)) return key;
  }
  return null;
}

function loopCorners(map: GameMap) {
  return new Set(map.sectors.flatMap((sector) => sectorLoops(sector).flat()));
}

// Whether two rooms lie partly over each other, each reaching inside the
// other, rather than one sitting wholly inside the other.
function getIsCrossing(map: GameMap, first: Sector, second: Sector) {
  const reachesInto = (room: Sector, other: Sector) => {
    const polygon = sectorPolygon(map, other);
    const theirs = new Set(
      loopEdges(other.vertices).map(({ from, to }) => wallKey(from, to)),
    );
    return loopEdges(room.vertices).some(
      ({ from, to }) =>
        !theirs.has(wallKey(from, to)) &&
        pointInPolygon(midpoint(map.vertices[from], map.vertices[to]), polygon),
    );
  };
  return reachesInto(first, second) && reachesInto(second, first);
}

function getIsOverPillar(map: GameMap, drawn: Sector, room: Sector) {
  const polygon = sectorPolygon(map, drawn);
  return (room.holes ?? []).some((hole) => {
    const pillar = loopPolygon(map, hole);
    return (
      loopEdges(hole).some(({ from, to }) =>
        pointInPolygon(midpoint(map.vertices[from], map.vertices[to]), polygon),
      ) ||
      loopEdges(drawn.vertices).some(({ from, to }) =>
        pointInPolygon(midpoint(map.vertices[from], map.vertices[to]), pillar),
      )
    );
  });
}

// Walls are traced into the faces they enclose, and each face becomes a room
// that copies the room it lies in. The biggest face from a room keeps its id,
// so switches, actions and the sides of its walls stay with it.
function rebuildRooms(
  map: GameMap,
  ids: string[],
  {
    add = [],
    keep = [],
    remove = new Set(),
    merge = false,
    weak,
  }: RebuildOptions,
): Rebuilt | null {
  const rooms = ids.flatMap(
    (id) => map.sectors.find((sector) => sector.id === id) ?? [],
  );
  if (rooms.length !== ids.length || rooms.some((room) => room.door)) {
    return null;
  }
  const primary = rooms[0];
  const walls = new Set<string>();
  for (const room of rooms) {
    for (const loop of sectorLoops(room)) {
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        if (!remove.has(key)) walls.add(key);
      }
    }
  }
  for (const { from, to } of add) walls.add(wallKey(from, to));
  // Rooms that stay as they are, whose walls the new faces go round: those
  // asked for, and every room drawn inside one being rebuilt.
  const fixed = map.sectors.filter(
    (sector) =>
      !ids.includes(sector.id) &&
      (keep.includes(sector.id) ||
        rooms.some((room) => containerOf(map, sector) === room)),
  );
  for (const room of fixed) {
    for (const { from, to } of loopEdges(room.vertices)) {
      walls.add(wallKey(from, to));
    }
  }
  if (getIsTangled(map, walls)) return null;
  const traced = traceCycles(map, walls);
  if (!traced) return null;

  const areas = new Map(
    rooms.map((room) => [
      room.id,
      Math.abs(signedArea(sectorPolygon(map, room))),
    ]),
  );
  const sourceAt = (point: Point) => {
    if (fixed.some((room) => pointInPolygon(point, sectorPolygon(map, room)))) {
      return null;
    }
    const holders = rooms.filter((room) => pointInSector(map, room, point));
    if (holders.length === 0) return null;
    if (merge) return primary;
    return holders.toSorted(
      (a, b) =>
        Number(a.id === weak) - Number(b.id === weak) ||
        (areas.get(a.id) ?? 0) - (areas.get(b.id) ?? 0),
    )[0];
  };
  const pieces: Piece[] = [];
  for (const face of traced.faces) {
    if (new Set(face.loop).size !== face.loop.length) return null;
    const point = insidePoint(face.polygon, 1);
    const source = sourceAt(point);
    if (source) pieces.push({ ...face, source, point, holes: [] });
  }
  if (pieces.length === 0) return null;

  // A boundary that faces into a piece around it is a pillar of that piece,
  // unless there is a room inside it.
  for (const bound of traced.bounds) {
    const outside = insidePoint(bound.polygon, 1);
    const around = pieces
      .filter((piece) => pointInPolygon(outside, piece.polygon))
      .toSorted((a, b) => a.area - b.area)[0];
    if (!around) continue;
    const within = insidePoint(bound.polygon, -1);
    const filled =
      sectorAt(map, within) ||
      pieces.some((piece) => pointInPolygon(piece.point, bound.polygon));
    if (filled) continue;
    if (new Set(bound.loop).size !== bound.loop.length) return null;
    around.holes.push(bound.loop.toReversed());
  }

  const used = map.sectors.map((sector) => sector.id);
  const idOf = new Map<Piece, string>();
  const bySource = new Map<string, Piece[]>();
  for (const piece of pieces) {
    bySource.set(piece.source.id, [
      ...(bySource.get(piece.source.id) ?? []),
      piece,
    ]);
  }
  for (const [sourceId, group] of bySource) {
    group
      .toSorted((a, b) => b.area - a.area)
      .forEach((piece, index) => {
        if (index === 0) {
          idOf.set(piece, sourceId);
          return;
        }
        const id = nextId("sector-", used);
        used.push(id);
        idOf.set(piece, id);
      });
  }

  const loopOwner = new Map<string, Sector>();
  for (const room of rooms) {
    for (const loop of sectorLoops(room)) {
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        if (!loopOwner.has(key)) loopOwner.set(key, room);
      }
    }
  }
  const overrideFor = (piece: Piece, wall: string) => {
    if (!merge) return piece.source.wallOverrides?.[wall];
    const owner = loopOwner.get(wall);
    if (!owner) return undefined;
    const own = owner.wallOverrides?.[wall];
    if (own) return own;
    return owner.wallTexture === primary.wallTexture
      ? undefined
      : owner.wallTexture;
  };

  const built = new Map<Piece, Sector>();
  let index = map.sectors.length;
  for (const piece of pieces) {
    const id = defined(idOf.get(piece));
    const kept = id === piece.source.id;
    if (!kept) index += 1;
    const room: Sector = {
      ...piece.source,
      id,
      name: kept ? piece.source.name : roomDefaults(index).name,
      vertices: piece.loop,
    };
    delete room.holes;
    delete room.details;
    delete room.wallOverrides;
    if (piece.holes.length > 0) room.holes = piece.holes;
    const overrides: Record<string, string> = {};
    for (const loop of sectorLoops(room)) {
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        const texture = overrideFor(piece, key);
        if (texture) overrides[key] = texture;
      }
    }
    if (Object.keys(overrides).length > 0) room.wallOverrides = overrides;
    built.set(piece, room);
  }

  // Lines drawn inside a room go to the piece each stretch now lies in.
  const effective = (id: string) => (merge ? primary.id : id);
  for (const room of rooms) {
    let chain: string[] = [];
    let holder: Sector | null = null;
    const close = () => {
      if (holder && chain.length >= 2) {
        holder.details = [...(holder.details ?? []), chain];
      }
      chain = [];
      holder = null;
    };
    for (const detail of room.details ?? []) {
      close();
      for (const [at, to] of detail.slice(1).entries()) {
        const from = detail[at];
        const key = wallKey(from, to);
        const middle = midpoint(map.vertices[from], map.vertices[to]);
        const piece = walls.has(key)
          ? undefined
          : pieces.find(
              (item) =>
                item.source.id === effective(room.id) &&
                pointInPolygon(middle, item.polygon) &&
                !item.holes.some((hole) =>
                  pointInPolygon(middle, loopPolygon(map, hole)),
                ),
            );
        const target = piece ? defined(built.get(piece)) : null;
        if (target !== holder || chain.at(-1) !== from) {
          close();
          holder = target;
          if (target) chain = [from];
        }
        if (target) chain.push(to);
      }
    }
    close();
  }

  const newOwner = new Map<string, Map<string, string>>();
  for (const [piece, room] of built) {
    for (const { from, to } of sectorEdges(room)) {
      const key = wallKey(from, to);
      const owners = newOwner.get(key) ?? new Map<string, string>();
      if (!owners.has(piece.source.id)) owners.set(piece.source.id, room.id);
      newOwner.set(key, owners);
    }
  }
  const moved = new Set(rooms.map((room) => room.id));
  const ownerFor = (wall: string, id: string) =>
    newOwner.get(wall)?.get(effective(id));

  const lines: Record<string, LineSettings> = {};
  for (const [wall, line] of Object.entries(map.lines ?? {})) {
    const sides: Record<string, LineSide> = {};
    for (const [sectorId, side] of Object.entries(line.sides ?? {})) {
      const target = moved.has(sectorId) ? ownerFor(wall, sectorId) : sectorId;
      if (target && !(target in sides)) sides[target] = side;
    }
    const front =
      line.front && moved.has(line.front)
        ? ownerFor(wall, line.front)
        : line.front;
    const next: LineSettings = { ...line };
    delete next.sides;
    delete next.front;
    if (Object.keys(sides).length > 0) next.sides = sides;
    if (front) next.front = front;
    lines[wall] = next;
  }

  const switches = [];
  for (const item of map.switches) {
    if (!moved.has(item.sector)) {
      switches.push(item);
      continue;
    }
    const sector = ownerFor(wallKey(item.from, item.to), item.sector);
    if (!sector) return null;
    switches.push({ ...item, sector });
  }

  const sectors: Sector[] = [];
  for (const sector of map.sectors) {
    if (!moved.has(sector.id)) {
      sectors.push(sector);
      continue;
    }
    const same = [...built.values()].find((room) => room.id === sector.id);
    if (same) sectors.push(same);
  }
  for (const room of built.values()) {
    if (!moved.has(room.id)) sectors.push(room);
  }
  const next: GameMap = {
    ...map,
    sectors,
    switches,
    lines: Object.keys(lines).length > 0 ? lines : undefined,
  };
  if (!map.lines) delete next.lines;
  // A switch hangs on a wall with nothing behind it.
  const owners = wallOwners(next);
  if (
    switches.some(
      (item) => owners.get(wallKey(item.from, item.to))?.length !== 1,
    )
  ) {
    return null;
  }
  return {
    map: next,
    rooms: pieces.map((piece) => ({
      id: defined(idOf.get(piece)),
      source: piece.source.id,
      point: piece.point,
      area: piece.area,
    })),
  };
}

// Whether two of the walls cross or touch anywhere but a corner they share,
// as they do across a wall left whole because a switch hangs on it.
function getIsTangled(map: GameMap, walls: Set<string>) {
  const list = [...walls];
  return list.some((first, index) =>
    list.slice(index + 1).some((second) => getDoWallsMeet(map, first, second)),
  );
}

function getDoWallsMeet(map: GameMap, first: string, second: string) {
  const [a, b] = first.split("|");
  const [c, d] = second.split("|");
  const shared = [a, b].filter((id) => id === c || id === d);
  if (shared.length === 2) return false;
  if (shared.length === 1) {
    const corner = map.vertices[shared[0]];
    const own = map.vertices[a === shared[0] ? b : a];
    const other = map.vertices[c === shared[0] ? d : c];
    return (
      cross(corner, own, other) === 0 &&
      (own.x - corner.x) * (other.x - corner.x) +
        (own.y - corner.y) * (other.y - corner.y) >
        0
    );
  }
  return segmentsIntersect(
    map.vertices[a],
    map.vertices[b],
    map.vertices[c],
    map.vertices[d],
  );
}

// Every closed run of walls, each traced with its face on the left. A face
// runs one way round and comes out with a positive area; the boundary of a
// group of walls, seen from outside, runs the other way.
function traceCycles(map: GameMap, walls: Iterable<string>) {
  const around = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = around.get(from);
    if (list) list.push(to);
    else around.set(from, [to]);
  };
  for (const wall of walls) {
    const [a, b] = wall.split("|");
    if (a === b || !map.vertices[a] || !map.vertices[b]) continue;
    link(a, b);
    link(b, a);
  }
  // A wall leading nowhere bounds no face.
  let loose = [...around.keys()].filter(
    (id) => defined(around.get(id)).length < 2,
  );
  while (loose.length > 0) {
    const next: string[] = [];
    for (const id of loose) {
      for (const other of around.get(id) ?? []) {
        const list = around.get(other);
        if (!list) continue;
        const kept = list.filter((item) => item !== id);
        around.set(other, kept);
        if (kept.length === 1) next.push(other);
      }
      around.delete(id);
    }
    loose = next.filter((id) => around.has(id));
  }
  for (const [id, list] of around) {
    const at = map.vertices[id];
    const angle = (other: string) => {
      const to = map.vertices[other];
      return Math.atan2(to.y - at.y, to.x - at.x);
    };
    list.sort((a, b) => angle(a) - angle(b));
  }
  const seen = new Set<string>();
  const faces: Cycle[] = [];
  const bounds: Cycle[] = [];
  for (const [start, list] of around) {
    for (const first of list) {
      if (seen.has(`${start}>${first}`)) continue;
      const loop: string[] = [];
      let from = start;
      let to = first;
      while (!seen.has(`${from}>${to}`)) {
        seen.add(`${from}>${to}`);
        loop.push(from);
        const ring = defined(around.get(to));
        const next = ring[(ring.indexOf(from) - 1 + ring.length) % ring.length];
        from = to;
        to = next;
      }
      if (from !== start || to !== first) return null;
      const polygon = loopPolygon(map, loop);
      const area = signedArea(polygon);
      if (area === 0) return null;
      (area > 0 ? faces : bounds).push({
        loop,
        polygon,
        area: Math.abs(area),
      });
    }
  }
  return { faces, bounds };
}

// A point this close to a wall, on its inner side, lies in the face the wall
// bounds: corners sit on whole units, so nothing else comes that close.
const inset = 0.01;

// A point beside the middle of the cycle's first wall, on its left with
// `side` 1 and on its right with -1.
function insidePoint(polygon: Point[], side: 1 | -1): Point {
  const a = polygon[0];
  const b = polygon[1 % polygon.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: (a.x + b.x) / 2 - (dy / length) * inset * side,
    y: (a.y + b.y) / 2 + (dx / length) * inset * side,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function allWalls(map: GameMap) {
  const walls = new Map<string, Edge>();
  for (const sector of map.sectors) {
    for (const edge of sectorEdges(sector)) {
      walls.set(wallKey(edge.from, edge.to), edge);
    }
  }
  return walls;
}
