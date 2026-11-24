import { defined } from "@/lib/defined";

import type { GameMap, Point, Sector } from "./types";

export interface Edge {
  from: string;
  to: string;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Outline {
  polygon: Point[];
  box: Box;
  area: number;
}

interface SectorIndex {
  outlines: Map<Sector, Outline>;
  cells: Map<number, Sector[]>;
}

const cellSize = 512;
const cellOffset = 1024;
const cellRow = 4096;
const scanLines = 32;

// Maps are replaced on every edit, never changed in place, so what's worked
// out for one stays right for as long as it's in use.
const containerCache = new WeakMap<GameMap, Map<string, Sector | null>>();
const ownerCache = new WeakMap<GameMap, Map<string, Sector[]>>();
const pointCache = new WeakMap<GameMap, Map<string, Point>>();

export function loopEdges(loop: string[]): Edge[] {
  return loop.map((from, index) => ({
    from,
    to: loop[(index + 1) % loop.length],
  }));
}

export function sectorLoops(sector: Sector) {
  return [sector.vertices, ...(sector.holes ?? [])];
}

// Lines drawn inside a room, as open chains of corners.
export function sectorDetails(sector: Sector): Edge[] {
  return (sector.details ?? []).flatMap((chain) =>
    chain.slice(1).map((to, index) => ({ from: chain[index], to })),
  );
}

export function sectorVertices(sector: Sector) {
  return [...sectorLoops(sector).flat(), ...(sector.details ?? []).flat()];
}

export function sectorEdges(sector: Sector): Edge[] {
  return [...sectorLoops(sector).flatMap(loopEdges), ...sectorDetails(sector)];
}

export function wallKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function wallTextureOf(sector: Sector, wall: string) {
  return sector.wallOverrides?.[wall] ?? sector.wallTexture;
}

export function wallPartTexture(
  map: GameMap,
  sector: Sector,
  wall: string,
  part: "upper" | "middle" | "lower",
) {
  const side = map.lines?.[wall]?.sides?.[sector.id];
  return (
    (part === "middle" ? undefined : side?.[part]) ??
    wallTextureOf(sector, wall)
  );
}

export function loopPolygon(map: GameMap, loop: string[]): Point[] {
  return loop.map((id) => map.vertices[id]);
}

export function sectorPolygon(map: GameMap, sector: Sector): Point[] {
  return loopPolygon(map, sector.vertices);
}

export function sectorHoles(map: GameMap, sector: Sector): Point[][] {
  return (sector.holes ?? []).map((hole) => loopPolygon(map, hole));
}

export function signedArea(polygon: Point[]) {
  let area = 0;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    area += point.x * next.y - next.x * point.y;
  });
  return area / 2;
}

export function boxOf(points: Point[]): Box {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function onSegment(a: Point, b: Point, point: Point) {
  return (
    cross(a, b, point) === 0 &&
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const d1 = Math.sign(cross(c, d, a));
  const d2 = Math.sign(cross(c, d, b));
  const d3 = Math.sign(cross(a, b, c));
  const d4 = Math.sign(cross(a, b, d));
  if (d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) {
    return true;
  }
  return (
    onSegment(c, d, a) ||
    onSegment(c, d, b) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d)
  );
}

export function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
        );
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

// A point strictly inside a simple polygon: the corner furthest left is
// convex, so the middle of its ear is inside unless another corner pokes into
// the ear, and then the way to the corner poking in deepest is.
export function interiorPoint(polygon: Point[]): Point {
  const count = polygon.length;
  let at = 0;
  for (let index = 1; index < count; index += 1) {
    const point = polygon[index];
    const best = polygon[at];
    if (point.x < best.x || (point.x === best.x && point.y < best.y)) {
      at = index;
    }
  }
  const corner = polygon[at];
  const before = polygon[(at + count - 1) % count];
  const after = polygon[(at + 1) % count];
  let deepest: Point | null = null;
  let depth = -1;
  polygon.forEach((point, index) => {
    if (index === at || index === (at + count - 1) % count) return;
    if (index === (at + 1) % count) return;
    if (!inTriangle(before, corner, after, point)) return;
    const reach = Math.abs(cross(before, after, point));
    if (reach > depth) {
      deepest = point;
      depth = reach;
    }
  });
  if (deepest === null) {
    return {
      x: (before.x + corner.x + after.x) / 3,
      y: (before.y + corner.y + after.y) / 3,
    };
  }
  const found: Point = deepest;
  return { x: (corner.x + found.x) / 2, y: (corner.y + found.y) / 2 };
}

// The spot inside a room, clear of its pillars and the rooms drawn inside it,
// that stands furthest from any wall among those on a set of level lines. A
// line between each pair of neighbouring corner y values crosses every part
// of the room, so even a thin walkway round a pillar is found.
export function roomPoint(map: GameMap, sector: Sector): Point {
  const cached = pointCache.get(map)?.get(sector.id);
  if (cached) return cached;
  const outline = sectorPolygon(map, sector);
  const inner = map.sectors
    .filter((other) => containerOf(map, other)?.id === sector.id)
    .map((other) => sectorPolygon(map, other));
  const loops = [outline, ...sectorHoles(map, sector), ...inner];
  const walls = loops.flatMap((loop) =>
    loop.map((point, index) => [point, loop[(index + 1) % loop.length]]),
  );
  const box = boxOf(outline);
  const corners = new Set(loops.flat().map((point) => point.y));
  const levels = [...corners].toSorted((a, b) => a - b);
  const lines = [
    ...levels.slice(1).map((y, index) => (levels[index] + y) / 2),
    ...Array.from(
      { length: scanLines },
      (_, index) =>
        box.top + ((index + 0.5) * (box.bottom - box.top)) / scanLines,
    ),
  ].filter((y) => !corners.has(y));
  let best: Point | null = null;
  let clearance = -1;
  for (const y of lines) {
    const crossings = walls
      .filter(([a, b]) => a.y <= y !== b.y <= y)
      .map(([a, b]) => a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
      .toSorted((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const point = { x: (crossings[index] + crossings[index + 1]) / 2, y };
      if (sectorAt(map, point)?.id !== sector.id) continue;
      const reach = Math.min(
        ...walls.map(([a, b]) => segmentDistance(a, b, point)),
      );
      if (reach > clearance) {
        best = point;
        clearance = reach;
      }
    }
  }
  const point = best ?? interiorPoint(outline);
  const points = pointCache.get(map) ?? new Map<string, Point>();
  points.set(sector.id, point);
  pointCache.set(map, points);
  return point;
}

export function pointInSector(map: GameMap, sector: Sector, point: Point) {
  return (
    pointInPolygon(point, sectorPolygon(map, sector)) &&
    !sectorHoles(map, sector).some((hole) => pointInPolygon(point, hole))
  );
}

export function sectorAt(map: GameMap, point: Point) {
  const sector = innermostAt(map, point);
  return sector &&
    !sectorHoles(map, sector).some((hole) => pointInPolygon(point, hole))
    ? sector
    : undefined;
}

export function holeAt(map: GameMap, point: Point) {
  const sector = innermostAt(map, point);
  if (!sector) return null;
  const index = sectorHoles(map, sector).findIndex((hole) =>
    pointInPolygon(point, hole),
  );
  return index < 0 ? null : { sector, index };
}

// The room each room is drawn inside, if any. A room inside a pillar has
// none, because a pillar is empty space.
export function sectorContainers(map: GameMap) {
  const cached = containerCache.get(map);
  if (cached) return cached;
  const containers = new Map<string, Sector | null>();
  // A room with a missing corner has no outline, so it is neither inside
  // anything nor around anything.
  const outlines = map.sectors
    .filter((sector) => sectorVertices(sector).every((id) => map.vertices[id]))
    .map((sector) => {
      const polygon = sectorPolygon(map, sector);
      return {
        sector,
        polygon,
        area: Math.abs(signedArea(polygon)),
        box: boxOf(polygon),
      };
    })
    .toSorted((a, b) => a.area - b.area);
  outlines.forEach((outline, index) => {
    let container: Sector | null = null;
    if (outline.polygon.length >= 3) {
      const inside = interiorPoint(outline.polygon);
      for (let other = index + 1; other < outlines.length; other += 1) {
        const candidate = outlines[other];
        if (candidate.area <= outline.area) continue;
        if (!boxContains(candidate.box, outline.box)) continue;
        if (!pointInPolygon(inside, candidate.polygon)) continue;
        const inHole = sectorHoles(map, candidate.sector).some((hole) =>
          pointInPolygon(inside, hole),
        );
        container = inHole ? null : candidate.sector;
        break;
      }
    }
    containers.set(outline.sector.id, container);
  });
  containerCache.set(map, containers);
  return containers;
}

export function containerOf(map: GameMap, sector: Sector) {
  return sectorContainers(map).get(sector.id) ?? null;
}

// The rooms on each side of a wall. A room drawn inside another opens onto
// it through every wall no other room shares, unless the wall is kept solid,
// and covers the side of any pillar it is drawn against.
export function wallOwners(map: GameMap) {
  const cached = ownerCache.get(map);
  if (cached) return cached;
  const owners = new Map<string, Sector[]>();
  const pillarSides = new Set<string>();
  for (const sector of map.sectors) {
    sectorLoops(sector).forEach((loop, at) => {
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        owners.set(key, [...(owners.get(key) ?? []), sector]);
        if (at > 0) pillarSides.add(`${sector.id}:${key}`);
      }
    });
    // A line drawn inside a room has that room on both of its sides.
    for (const { from, to } of sectorDetails(sector)) {
      const key = wallKey(from, to);
      owners.set(key, [...(owners.get(key) ?? []), sector, sector]);
    }
  }
  for (const sector of map.sectors) {
    const container = containerOf(map, sector);
    if (!container) continue;
    for (const { from, to } of loopEdges(sector.vertices)) {
      const key = wallKey(from, to);
      const list = owners.get(key) ?? [];
      if (list.length === 1) {
        if (!map.lines?.[key]?.solid) owners.set(key, [...list, container]);
      } else if (
        list.includes(container) &&
        pillarSides.has(`${container.id}:${key}`)
      ) {
        owners.set(
          key,
          list.filter((item) => item !== container),
        );
      }
    }
  }
  ownerCache.set(map, owners);
  return owners;
}

// The order the engine reads an outline in, with its room on the right: a
// room's outline runs one way round and a pillar's the other.
export function engineOrder(map: GameMap, loop: string[], pillar: boolean) {
  const area = signedArea(loopPolygon(map, loop));
  return (pillar ? area > 0 : area < 0) ? loop.toReversed() : loop;
}

// The corner a room's wall starts at as the engine reads it, where its
// texture begins.
export function wallStart(map: GameMap, sector: Sector, wall: string) {
  for (const [at, loop] of sectorLoops(sector).entries()) {
    const edge = loopEdges(engineOrder(map, loop, at > 0)).find(
      (item) => wallKey(item.from, item.to) === wall,
    );
    if (edge) return edge.from;
  }
  return (
    sectorDetails(sector).find((item) => wallKey(item.from, item.to) === wall)
      ?.from ?? null
  );
}

// Bigger rooms first, so a room drawn inside another paints over it.
export function paintOrder(map: GameMap) {
  return map.sectors
    .map((sector) => ({
      sector,
      area: Math.abs(signedArea(sectorPolygon(map, sector))),
    }))
    .toSorted((a, b) => b.area - a.area)
    .map(({ sector }) => sector);
}

export function loopsPath(loops: Point[][]) {
  return loops
    .filter((loop) => loop.length > 0)
    .map(
      (loop) => `M${loop.map((point) => `${point.x} ${point.y}`).join("L")}Z`,
    )
    .join("");
}

function segmentDistance(a: Point, b: Point, point: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
        );
  return Math.hypot(a.x + along * dx - point.x, a.y + along * dy - point.y);
}

function inTriangle(a: Point, b: Point, c: Point, point: Point) {
  const first = cross(a, b, point);
  const second = cross(b, c, point);
  const third = cross(c, a, point);
  const negative = first < 0 || second < 0 || third < 0;
  const positive = first > 0 || second > 0 || third > 0;
  return !(negative && positive);
}

// The smallest room whose outline holds the point is the one drawn deepest
// inside the others, and a pillar there is empty space.
function innermostAt(map: GameMap, point: Point) {
  const { outlines, cells } = sectorIndex(map);
  let best: Sector | undefined;
  let bestArea = Infinity;
  for (const sector of cells.get(cellOf(point.x, point.y)) ?? []) {
    const { polygon, box, area } = defined(outlines.get(sector));
    if (!inBox(box, point) || !pointInPolygon(point, polygon)) continue;
    if (area < bestArea) {
      best = sector;
      bestArea = area;
    }
  }
  return best;
}

const indexCache = new WeakMap<GameMap, SectorIndex>();

// Each sector is filed under the grid cells its bounds cover, in map order, so
// a point is tested against the few sectors around it, not every one on the
// map. A sector with a missing corner has no outline and is never found.
function sectorIndex(map: GameMap): SectorIndex {
  const cached = indexCache.get(map);
  if (cached) return cached;
  const outlines = new Map<Sector, Outline>();
  const cells = new Map<number, Sector[]>();
  for (const sector of map.sectors) {
    const polygon = sectorPolygon(map, sector);
    if (polygon.length === 0 || polygon.some((point) => !point)) continue;
    const box = boxOf(polygon);
    outlines.set(sector, { polygon, box, area: Math.abs(signedArea(polygon)) });
    const left = Math.floor(box.left / cellSize);
    const right = Math.floor(box.right / cellSize);
    const top = Math.floor(box.top / cellSize);
    const bottom = Math.floor(box.bottom / cellSize);
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const key = (x + cellOffset) * cellRow + y + cellOffset;
        const filed = cells.get(key);
        if (filed) filed.push(sector);
        else cells.set(key, [sector]);
      }
    }
  }
  const index = { outlines, cells };
  indexCache.set(map, index);
  return index;
}

function cellOf(x: number, y: number) {
  return (
    (Math.floor(x / cellSize) + cellOffset) * cellRow +
    Math.floor(y / cellSize) +
    cellOffset
  );
}

function inBox(box: Box, point: Point) {
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom
  );
}

function boxContains(outer: Box, inner: Box) {
  return (
    outer.left <= inner.left &&
    outer.right >= inner.right &&
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom
  );
}
