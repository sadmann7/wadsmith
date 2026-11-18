import {
  pointInPolygon,
  sectorAt,
  sectorEdges,
  sectorPolygon,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
} from "./geometry";
import { appearsOn } from "./balance";
import { keyThings } from "./catalog";
import { describeLine, lineUsesTag } from "./lines";
import type { GameMap, Sector, ThingSkill } from "./types";

type MapIssue = {
  id: string;
  message: string;
  detail?: string;
  target?: string;
};

const skills: ThingSkill[] = ["easy", "medium", "hard"];
const coordinateLimit = 32000;
const heightLimit = 32767;
const doorClearance = 4;
const playerHeight = 56;

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
  if (!sector.door && sector.ceiling <= sector.floor) {
    add("height", "ceiling must be above the floor.");
  }
  if (
    !Number.isInteger(sector.floor) ||
    !Number.isInteger(sector.ceiling) ||
    Math.abs(sector.floor) > heightLimit ||
    Math.abs(sector.ceiling) > heightLimit ||
    sector.ceiling - sector.floor > heightLimit
  ) {
    add("height-range", "floor and ceiling must be whole numbers in range.");
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

function activeLineActions(map: GameMap) {
  const owners = wallOwners(map);
  return Object.entries(map.lines ?? {}).flatMap(([wall, { action }]) => {
    const owner = owners.get(wall)?.[0];
    if (!action || !owner) return [];
    const line = describeLine(map, wall, owner.id);
    return line.wiredSwitch ? [] : [{ wall, action, line }];
  });
}

// A closed door can't be crossed, and its track walls are out of reach.
function lineOpensDoor(
  { action, line }: ReturnType<typeof activeLineActions>[number],
  door: Sector,
) {
  if (action.kind !== "door-raise" && action.kind !== "door-open") return false;
  const behind = line.back?.id === door.id;
  if (action.trigger === "door") return behind;
  return (
    action.tag === door.tag &&
    line.front.id !== door.id &&
    !(action.trigger === "walk" && (behind || line.settings.blocksAll))
  );
}

function validateDoors(map: GameMap, issues: MapIssue[]) {
  const owners = wallOwners(map);
  const actions = activeLineActions(map);
  for (const sector of map.sectors) {
    if (!sector.door) continue;
    const add = (kind: string, message: string) =>
      issues.push({
        id: `${kind}:${sector.id}`,
        message: `${sector.name}: ${message}`,
        target: sector.id,
      });
    const neighbors = sectorEdges(sector).flatMap(({ from, to }) =>
      (owners.get(wallKey(from, to)) ?? []).filter((item) => item !== sector),
    );
    if (neighbors.length === 0) {
      add("door-alone", "a door must share a wall with a room.");
      continue;
    }
    if (neighbors.some((neighbor) => neighbor.door)) {
      add("door-pair", "a door can't touch another door.");
      continue;
    }
    const opening =
      Math.min(...neighbors.map((neighbor) => neighbor.ceiling)) -
      doorClearance -
      sector.floor;
    if (opening < playerHeight) {
      add("door-low", "the rooms beside it are too low for the door to open.");
    }
    if (
      sector.door.opensBy === "switch" &&
      !map.switches.some((item) => item.door === sector.id) &&
      !actions.some((entry) => lineOpensDoor(entry, sector))
    ) {
      add("door-unwired", "connect a switch to open this door.");
    }
  }

  for (const item of map.switches) {
    const add = (kind: string, message: string) =>
      issues.push({
        id: `${kind}:${item.id}`,
        message: `Switch ${item.id}: ${message}`,
        target: item.id,
      });
    const wall = owners.get(wallKey(item.from, item.to));
    if (!wall?.some((sector) => sector.id === item.sector)) {
      add("switch-wall", "its wall no longer exists.");
    } else if (wall.length > 1) {
      add("switch-open", "it must sit on a solid wall.");
    }
    if (!item.door) {
      if (!map.lines?.[wallKey(item.from, item.to)]?.action) {
        add("switch-unwired", "connect it to a door or give it an action.");
      }
    } else if (!map.sectors.find((sector) => sector.id === item.door)?.door) {
      add("switch-target", "the room it opens is not a door.");
    }
  }
}

function validateLines(map: GameMap, issues: MapIssue[]) {
  for (const { wall, action, line } of activeLineActions(map)) {
    const add = (kind: string, message: string) =>
      issues.push({
        id: `${kind}:${wall}`,
        message: `Line ${line.number}: ${message}`,
        target: wall,
      });
    if (!line.twoSided && action.trigger === "door") {
      add("line-door", "a press-to-open door needs a sector behind the line.");
    } else if (!line.twoSided && action.trigger === "walk") {
      add("line-walk", "nothing can walk over a solid wall.");
    }
    if (action.key) {
      const kind = keyThings[action.key];
      const keys = map.things.filter((thing) => thing.kind === kind);
      if (
        !skills.every((skill) =>
          keys.some((key) => appearsOn(key.skills, skill)),
        )
      ) {
        add("line-key", `place the ${action.key} key on every difficulty.`);
      }
    }
    if (!lineUsesTag(action)) continue;
    if (!action.tag) {
      add("line-target", "choose the sector this action moves.");
    } else if (!map.sectors.some((sector) => sector.tag === action.tag)) {
      add("line-tag", "the sector this action moves no longer has its tag.");
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
    validateDoors(map, issues);
    validateLines(map, issues);
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
      const room = sectorAt(map, thing);
      if (room?.door) {
        issues.push({
          id: `in-door:${thing.id}`,
          message: `${thing.id} is inside a closed door.`,
          target: thing.id,
        });
      }
      if (!room) {
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

export { activeLineActions, validateMap, type MapIssue };
