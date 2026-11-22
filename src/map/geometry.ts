import type { GameMap, Point, Sector } from "./types";

type Edge = { from: string; to: string };

type Box = { left: number; top: number; right: number; bottom: number };

type Outline = { polygon: Point[]; box: Box; area: number };

type SectorIndex = {
  outlines: Map<Sector, Outline>;
  cells: Map<number, Sector[]>;
};

const cellSize = 512;
const cellOffset = 1024;
const cellRow = 4096;

// Maps are replaced on every edit, never changed in place, so what's worked
// out for one stays right for as long as it's in use.
const containerCache = new WeakMap<GameMap, Map<string, Sector | null>>();
const ownerCache = new WeakMap<GameMap, Map<string, Sector[]>>();
const indexCache = new WeakMap<GameMap, SectorIndex>();

function loopEdges(loop: string[]): Edge[] {
  return loop.map((from, index) => ({
    from,
    to: loop[(index + 1) % loop.length],
  }));
}

function sectorLoops(sector: Sector) {
  return [sector.vertices, ...(sector.holes ?? [])];
}

function sectorVertices(sector: Sector) {
  return sectorLoops(sector).flat();
}

function sectorEdges(sector: Sector): Edge[] {
  return sectorLoops(sector).flatMap(loopEdges);
}

function wallKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function wallTextureOf(sector: Sector, wall: string) {
  return sector.wallOverrides?.[wall] ?? sector.wallTexture;
}

function wallPartTexture(
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

function loopPolygon(map: GameMap, loop: string[]): Point[] {
  return loop.map((id) => map.vertices[id]);
}

function sectorPolygon(map: GameMap, sector: Sector): Point[] {
  return loopPolygon(map, sector.vertices);
}

function sectorHoles(map: GameMap, sector: Sector): Point[][] {
  return (sector.holes ?? []).map((hole) => loopPolygon(map, hole));
}

function signedArea(polygon: Point[]) {
  let area = 0;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    area += point.x * next.y - next.x * point.y;
  });
  return area / 2;
}

function boxOf(points: Point[]): Box {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function boxContains(outer: Box, inner: Box) {
  return (
    outer.left <= inner.left &&
    outer.right >= inner.right &&
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom
  );
}

function pointInPolygon(point: Point, polygon: Point[]) {
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

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, point: Point) {
  return (
    cross(a, b, point) === 0 &&
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
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

function inTriangle(a: Point, b: Point, c: Point, point: Point) {
  const first = cross(a, b, point);
  const second = cross(b, c, point);
  const third = cross(c, a, point);
  const negative = first < 0 || second < 0 || third < 0;
  const positive = first > 0 || second > 0 || third > 0;
  return !(negative && positive);
}

// A point strictly inside a simple polygon: the corner furthest left is
// convex, so the middle of its ear is inside unless another corner pokes into
// the ear, and then the way to the corner poking in deepest is.
function interiorPoint(polygon: Point[]): Point {
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

function pointInSector(map: GameMap, sector: Sector, point: Point) {
  return (
    pointInPolygon(point, sectorPolygon(map, sector)) &&
    !sectorHoles(map, sector).some((hole) => pointInPolygon(point, hole))
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

function cellOf(x: number, y: number) {
  return (
    (Math.floor(x / cellSize) + cellOffset) * cellRow +
    Math.floor(y / cellSize) +
    cellOffset
  );
}

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

// The smallest room whose outline holds the point is the one drawn deepest
// inside the others, and a pillar there is empty space.
function innermostAt(map: GameMap, point: Point) {
  const { outlines, cells } = sectorIndex(map);
  let best: Sector | undefined;
  let bestArea = Infinity;
  for (const sector of cells.get(cellOf(point.x, point.y)) ?? []) {
    const { polygon, box, area } = outlines.get(sector)!;
    if (!inBox(box, point) || !pointInPolygon(point, polygon)) continue;
    if (area < bestArea) {
      best = sector;
      bestArea = area;
    }
  }
  return best;
}

function sectorAt(map: GameMap, point: Point) {
  const sector = innermostAt(map, point);
  return sector &&
    !sectorHoles(map, sector).some((hole) => pointInPolygon(point, hole))
    ? sector
    : undefined;
}

function holeAt(map: GameMap, point: Point) {
  const sector = innermostAt(map, point);
  if (!sector) return null;
  const index = sectorHoles(map, sector).findIndex((hole) =>
    pointInPolygon(point, hole),
  );
  return index < 0 ? null : { sector, index };
}

// The room each room is drawn inside, if any. A room inside a pillar has
// none, because a pillar is empty space.
function sectorContainers(map: GameMap) {
  const cached = containerCache.get(map);
  if (cached) return cached;
  const containers = new Map<string, Sector | null>();
  const outlines = map.sectors
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

function containerOf(map: GameMap, sector: Sector) {
  return sectorContainers(map).get(sector.id) ?? null;
}

// The rooms on each side of a wall. A room drawn inside another opens onto
// it through every wall no other room shares, and covers the side of any
// pillar it is drawn against.
function wallOwners(map: GameMap) {
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
  }
  for (const sector of map.sectors) {
    const container = containerOf(map, sector);
    if (!container) continue;
    for (const { from, to } of loopEdges(sector.vertices)) {
      const key = wallKey(from, to);
      const list = owners.get(key) ?? [];
      if (list.length === 1) {
        owners.set(key, [...list, container]);
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

// Bigger rooms first, so a room drawn inside another paints over it.
function paintOrder(map: GameMap) {
  return map.sectors
    .map((sector) => ({
      sector,
      area: Math.abs(signedArea(sectorPolygon(map, sector))),
    }))
    .toSorted((a, b) => b.area - a.area)
    .map(({ sector }) => sector);
}

function loopsPath(loops: Point[][]) {
  return loops
    .filter((loop) => loop.length > 0)
    .map(
      (loop) => `M${loop.map((point) => `${point.x} ${point.y}`).join("L")}Z`,
    )
    .join("");
}

export {
  boxOf,
  containerOf,
  cross,
  holeAt,
  interiorPoint,
  loopEdges,
  loopPolygon,
  loopsPath,
  paintOrder,
  pointInPolygon,
  pointInSector,
  sectorAt,
  sectorContainers,
  sectorEdges,
  sectorHoles,
  sectorLoops,
  sectorPolygon,
  sectorVertices,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
  wallPartTexture,
  wallTextureOf,
  type Box,
  type Edge,
};
