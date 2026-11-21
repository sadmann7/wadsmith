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
import { isPlayerStart, keyThings, thingCatalog, thingKinds } from "./catalog";
import { describeLine, lineUsesTag } from "./lines";
import type { GameMap, Point, Sector, ThingSkill } from "./types";

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

const gridSize = 256;
const maxCells = 4096;

type Box = { left: number; top: number; right: number; bottom: number };

function boxOf(points: Point[]): Box {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

// Imported maps have thousands of walls, so each wall or room is only
// compared with the ones whose bounds meet its own.
function nearby(boxes: Box[]) {
  const span = (box: Box) => ({
    left: Math.floor(box.left / gridSize),
    right: Math.floor(box.right / gridSize),
    top: Math.floor(box.top / gridSize),
    bottom: Math.floor(box.bottom / gridSize),
  });
  // A box over too many cells, like a far-off corner's wall, meets every box.
  const wide = (box: Box) => {
    const cells = span(box);
    return (
      (cells.right - cells.left + 1) * (cells.bottom - cells.top + 1) > maxCells
    );
  };
  const cellsOf = (box: Box) => {
    const cells = span(box);
    const keys: string[] = [];
    for (let x = cells.left; x <= cells.right; x += 1) {
      for (let y = cells.top; y <= cells.bottom; y += 1) keys.push(`${x},${y}`);
    }
    return keys;
  };
  const cells = new Map<string, number[]>();
  const wideBoxes: number[] = [];
  boxes.forEach((box, index) => {
    if (wide(box)) {
      wideBoxes.push(index);
      return;
    }
    for (const key of cellsOf(box)) {
      cells.set(key, [...(cells.get(key) ?? []), index]);
    }
  });
  const meets = (a: Box, b: Box) =>
    a.left <= b.right &&
    a.right >= b.left &&
    a.top <= b.bottom &&
    a.bottom >= b.top;
  return (index: number) => {
    const box = boxes[index];
    const candidates = wide(box)
      ? boxes.keys()
      : [...cellsOf(box).flatMap((key) => cells.get(key) ?? []), ...wideBoxes];
    const found = new Set<number>();
    for (const other of candidates) {
      if (other !== index && meets(boxes[other], box)) found.add(other);
    }
    return [...found].toSorted((a, b) => a - b);
  };
}

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function validateSector(
  map: GameMap,
  sector: Sector,
  issues: MapIssue[],
  openedTags: () => Set<number>,
) {
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
  // A closed room is fine when a line action opens it, like a lowering pillar.
  const opens =
    sector.ceiling === sector.floor &&
    sector.tag !== undefined &&
    openedTags().has(sector.tag);
  if (!sector.door && sector.ceiling <= sector.floor && !opens) {
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
  const nearWalls = nearby(
    walls.map((wall) =>
      boxOf([map.vertices[wall.from], map.vertices[wall.to]]),
    ),
  );
  for (let i = 0; i < walls.length; i += 1) {
    for (const j of nearWalls(i)) {
      if (j <= i) continue;
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

  const nearSectors = nearby(
    map.sectors.map((sector) => boxOf(sectorPolygon(map, sector))),
  );
  for (const [index, sector] of map.sectors.entries()) {
    const polygon = sectorPolygon(map, sector);
    for (const other of nearSectors(index).map((near) => map.sectors[near])) {
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
  const entries = [...owners];
  return Object.entries(map.lines ?? {}).flatMap(([wall, { action }]) => {
    const owner = owners.get(wall)?.[0];
    if (!action || !owner) return [];
    const line = describeLine(map, wall, owner.id, entries);
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

type LineActions = ReturnType<typeof activeLineActions>;

function validateDoors(map: GameMap, issues: MapIssue[], actions: LineActions) {
  const owners = wallOwners(map);
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

function validateLines(map: GameMap, issues: MapIssue[], actions: LineActions) {
  for (const { wall, action, line } of actions) {
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
  let actions: LineActions | undefined;
  const lineActions = () => (actions ??= activeLineActions(map));
  let opened: Set<number> | undefined;
  const openedTags = () =>
    (opened ??= new Set(
      lineActions()
        .filter(({ action }) => action.kind !== "exit" && action.tag > 0)
        .map(({ action }) => action.tag),
    ));
  for (const sector of map.sectors) {
    validateSector(map, sector, issues, openedTags);
  }
  if (issues.length === 0) {
    validateNeighbors(map, issues);
    validateDoors(map, issues, lineActions());
    validateLines(map, issues, lineActions());
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
  for (const kind of thingKinds) {
    if (!isPlayerStart(kind)) continue;
    const starts = map.things.filter((thing) => thing.kind === kind);
    if (starts.length < 2) continue;
    issues.push({
      id: kind === "player" ? "many-players" : `many-players:${kind}`,
      message: `Keep only one ${thingCatalog[kind].label.toLowerCase()}.`,
      target: starts[1].id,
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
