import {
  pointInPolygon,
  sectorAt,
  sectorEdges,
  sectorPolygon,
  segmentsIntersect,
  signedArea,
} from "./geometry";
import type { GameMap, Sector } from "./types";

type MapIssue = { id: string; message: string; target?: string };

const coordinateLimit = 32000;

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function validateSector(map: GameMap, sector: Sector, issues: MapIssue[]) {
  const add = (kind: string, message: string) =>
    issues.push({
      id: `${kind}:${sector.id}`,
      message: `${sector.name}: ${message}`,
      target: sector.id,
    });

  if (new Set(sector.vertices).size !== sector.vertices.length) {
    add("repeat", "uses the same corner twice.");
    return;
  }
  if (sector.vertices.length < 3) {
    add("corners", "needs at least 3 corners.");
    return;
  }
  if (sector.vertices.some((id) => !map.vertices[id])) {
    add("missing", "references a corner that no longer exists.");
    return;
  }
  const polygon = sectorPolygon(map, sector);
  if (Math.abs(signedArea(polygon)) < 1) {
    add("area", "has no area.");
  }
  if (sector.ceiling <= sector.floor) {
    add("height", "ceiling must be above the floor.");
  }
  const edges = sectorEdges(sector);
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 2; j < edges.length; j += 1) {
      if (i === 0 && j === edges.length - 1) continue;
      if (
        segmentsIntersect(
          map.vertices[edges[i].from],
          map.vertices[edges[i].to],
          map.vertices[edges[j].from],
          map.vertices[edges[j].to],
        )
      ) {
        add("twist", "has walls that cross each other.");
        return;
      }
    }
  }
}

function validateNeighbors(map: GameMap, issues: MapIssue[]) {
  const usage = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    for (const edge of sectorEdges(sector)) {
      const key = edgeKey(edge.from, edge.to);
      usage.set(key, [...(usage.get(key) ?? []), sector]);
    }
  }
  for (const [key, sectors] of usage) {
    if (sectors.length > 2) {
      issues.push({
        id: `shared:${key}`,
        message: `${sectors.map((sector) => sector.name).join(", ")} all share one wall.`,
        target: sectors[0].id,
      });
    }
  }

  const walls = [...usage.keys()].map((key) => {
    const [from, to] = key.split("|");
    return { key, from, to };
  });
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const a = walls[i];
      const b = walls[j];
      if (
        a.from === b.from ||
        a.from === b.to ||
        a.to === b.from ||
        a.to === b.to
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          map.vertices[a.from],
          map.vertices[a.to],
          map.vertices[b.from],
          map.vertices[b.to],
        )
      ) {
        const sector = usage.get(a.key)![0];
        issues.push({
          id: `cross:${a.key}:${b.key}`,
          message: `${sector.name}: a wall touches or crosses another wall without sharing its corners.`,
          target: sector.id,
        });
      }
    }
  }

  for (const sector of map.sectors) {
    const polygon = sectorPolygon(map, sector);
    for (const other of map.sectors) {
      if (other === sector) continue;
      const shared = new Set(sector.vertices);
      const inside = other.vertices.some(
        (id) => !shared.has(id) && pointInPolygon(map.vertices[id], polygon),
      );
      if (inside) {
        issues.push({
          id: `overlap:${sector.id}:${other.id}`,
          message: `${other.name} overlaps ${sector.name}.`,
          target: other.id,
        });
      }
    }
  }
}

function validateMap(map: GameMap): MapIssue[] {
  const issues: MapIssue[] = [];
  if (map.sectors.length === 0) {
    issues.push({ id: "empty", message: "Draw at least one room." });
  }
  for (const sector of map.sectors) {
    validateSector(map, sector, issues);
  }
  if (issues.length === 0) {
    validateNeighbors(map, issues);
  }
  for (const [id, point] of Object.entries(map.vertices)) {
    if (
      Math.abs(point.x) > coordinateLimit ||
      Math.abs(point.y) > coordinateLimit
    ) {
      issues.push({
        id: `range:${id}`,
        message: "A corner is too far from the map center.",
      });
    }
  }

  const players = map.things.filter((thing) => thing.kind === "player");
  if (players.length === 0) {
    issues.push({ id: "no-player", message: "Place a player start." });
  }
  if (players.length > 1) {
    issues.push({
      id: "many-players",
      message: "Keep only one player start.",
      target: players[1].id,
    });
  }
  if (issues.length === 0) {
    for (const thing of map.things) {
      if (!sectorAt(map, thing)) {
        issues.push({
          id: `outside:${thing.id}`,
          message: `${thing.id} is outside every room.`,
          target: thing.id,
        });
      }
    }
  }
  return issues;
}

export { validateMap, type MapIssue };
