import type { GameMap, Point, Sector } from "./types";

type Edge = { from: string; to: string };

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

function wallOwners(map: GameMap) {
  const owners = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const key = wallKey(from, to);
      owners.set(key, [...(owners.get(key) ?? []), sector]);
    }
  }
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
  return map.sectors.find((sector) =>
    pointInPolygon(point, sectorPolygon(map, sector)),
  );
}

export {
  cross,
  pointInPolygon,
  sectorAt,
  sectorEdges,
  sectorPolygon,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
  wallTextureOf,
  type Edge,
};
