import type { GameMap, Point, Sector } from "./types";

type Edge = { from: string; to: string };

type Box = { left: number; top: number; right: number; bottom: number };

type Outline = { polygon: Point[]; box: Box };

type SectorIndex = {
  outlines: Map<Sector, Outline>;
  cells: Map<number, Sector[]>;
};

const cellSize = 512;
const cellOffset = 1024;
const cellRow = 4096;

// Maps are replaced on every edit, never changed in place, so what's worked
// out for one stays right for as long as it's in use.
const ownerCache = new WeakMap<GameMap, Map<string, Sector[]>>();
const indexCache = new WeakMap<GameMap, SectorIndex>();

function sectorEdges(sector: Sector): Edge[] {
  return sector.vertices.map((from, index) => ({
    from,
    to: sector.vertices[(index + 1) % sector.vertices.length],
  }));
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

function wallOwners(map: GameMap) {
  const cached = ownerCache.get(map);
  if (cached) return cached;
  const owners = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const key = wallKey(from, to);
      owners.set(key, [...(owners.get(key) ?? []), sector]);
    }
  }
  ownerCache.set(map, owners);
  return owners;
}

function sectorPolygon(map: GameMap, sector: Sector): Point[] {
  return sector.vertices.map((id) => map.vertices[id]);
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
  const box = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (const point of points) {
    box.left = Math.min(box.left, point.x);
    box.top = Math.min(box.top, point.y);
    box.right = Math.max(box.right, point.x);
    box.bottom = Math.max(box.bottom, point.y);
  }
  return box;
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
    outlines.set(sector, { polygon, box });
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

function sectorBox(map: GameMap, sector: Sector): Box | undefined {
  return sectorIndex(map).outlines.get(sector)?.box;
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

function sectorAt(map: GameMap, point: Point) {
  const { outlines, cells } = sectorIndex(map);
  return cells.get(cellOf(point.x, point.y))?.find((sector) => {
    const { polygon, box } = outlines.get(sector)!;
    return inBox(box, point) && pointInPolygon(point, polygon);
  });
}

export {
  cross,
  pointInPolygon,
  sectorAt,
  sectorBox,
  sectorEdges,
  sectorPolygon,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
  wallPartTexture,
  wallTextureOf,
  type Box,
  type Edge,
};
