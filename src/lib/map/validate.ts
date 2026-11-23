import type { GameInfo } from "@/lib/engine/game";

import { defined } from "@/lib/defined";

import type { TextureNames } from "./textures";
import type { Complevel, GameMap, Point, Sector, ThingSkill } from "./types";

import { appearsOn } from "./balance";
import {
  generalizedKind,
  generalizedTrigger,
  getIsDoorClass,
  getIsGeneralized,
} from "./boom";
import {
  getIsPlayerStart,
  keyThings,
  thingCatalog,
  thingKinds,
} from "./catalog";
import {
  atLeast,
  complevelLabels,
  lineLevel,
  linePassUse,
  sectorLevel,
} from "./complevel";
import {
  type Box,
  boxOf,
  containerOf,
  loopEdges,
  loopPolygon,
  onSegment,
  pointInPolygon,
  pointInSector,
  sectorAt,
  sectorDetails,
  sectorEdges,
  sectorHoles,
  sectorLoops,
  sectorPolygon,
  sectorVertices,
  segmentsIntersect,
  signedArea,
  wallKey,
  wallOwners,
} from "./geometry";
import {
  describeLine,
  getIsTeleport,
  lineUsesTag,
  movesSector,
  opensDoor,
} from "./lines";

// What the browser plays on, which a map can outgrow after it was saved.
export interface CheckContext {
  game?: GameInfo;
  names?: TextureNames;
}

export interface MapIssue {
  id: string;
  message: string;
  detail?: string;
  target?: string;
  // Where the 3D view stands to see it, in degrees counterclockwise from east.
  view?: { x: number; y: number; angle: number };
}

const coordinateLimit = 32000;

interface Wall {
  from: string;
  to: string;
}

export function activeLineActions(map: GameMap) {
  const owners = wallOwners(map);
  const entries = [...owners];
  return Object.entries(map.lines ?? {}).flatMap(([wall, { action }]) => {
    const owner = owners.get(wall)?.[0];
    if (!action || !owner) return [];
    const line = describeLine(map, wall, owner.id, entries);
    return line.wiredSwitch ? [] : [{ wall, action, line }];
  });
}

type LineActions = ReturnType<typeof activeLineActions>;

// Warnings are legal in Doom but likely mistakes, so they don't block a build.
export function inspectMap(map: GameMap, context: CheckContext = {}) {
  const issues: MapIssue[] = [];
  const warnings: MapIssue[] = [];
  if (map.sectors.length === 0) {
    issues.push({ id: "empty", message: "Draw at least one room." });
  }
  let actions: LineActions | undefined;
  const lineActions = () => (actions ??= activeLineActions(map));
  let opened: Set<number> | undefined;
  // A raw special with a tag may move its sector too, so it counts as opening.
  const openedTags = () =>
    (opened ??= new Set([
      ...lineActions()
        .filter(
          ({ action }) =>
            movesSector(action.kind) && lineUsesTag(action) && action.tag > 0,
        )
        .map(({ action }) => action.tag),
      ...Object.values(map.lines ?? {}).flatMap((line) =>
        line.raw && line.raw.tag > 0 && !line.action ? [line.raw.tag] : [],
      ),
    ]));
  for (const sector of map.sectors) {
    validateSector(map, sector, issues, openedTags);
  }
  // The checks between rooms wait until every room is sound, and the checks
  // of where things stand until nothing else is wrong. Each layer lists the
  // errors it found, or is null when it never ran.
  const layers: { rooms: string[] | null; things: string[] | null } = {
    rooms: null,
    things: null,
  };
  if (issues.length === 0) {
    validateNeighbors(map, issues);
    validateDoors(map, issues, warnings, lineActions(), openedTags());
    validateLines(map, issues, warnings, lineActions());
    layers.rooms = issues.map((issue) => issue.id);
  }
  validateLevels(map, issues, warnings, issues.length === 0);
  validateGame(map, issues, context);
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
    if (!getIsPlayerStart(kind)) continue;
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
        (getIsPlayerStart(thing.kind) ? issues : warnings).push({
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
    layers.things = issues.map((issue) => issue.id);
  }
  return { errors: issues, warnings, layers };
}

export function validateMap(map: GameMap, context?: CheckContext): MapIssue[] {
  return inspectMap(map, context).errors;
}

// Problems are counted by kind, since an edit can rename walls and rooms.
// An old problem that keeps its id uses up its count first.
export function newProblems(before: GameMap, after: GameMap): MapIssue[] {
  const old = validateMap(before);
  const oldIds = new Set(old.map((issue) => issue.id));
  const counts = new Map<string, number>();
  for (const issue of old) {
    const kind = issueKind(issue);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const found = validateMap(after);
  return [
    ...found.filter((issue) => oldIds.has(issue.id)),
    ...found.filter((issue) => !oldIds.has(issue.id)),
  ].filter((issue) => {
    const kind = issueKind(issue);
    const left = counts.get(kind) ?? 0;
    counts.set(kind, left - 1);
    return left <= 0;
  });
}

function issueKind(issue: MapIssue) {
  return issue.id.split(":")[0];
}

const heightLimit = 32767;

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

  const loops = sectorLoops(sector);
  if (loops.some((loop) => new Set(loop).size !== loop.length)) {
    add("repeat", "uses the same corner twice.");
    return;
  }
  if (loops.some((loop) => loop.length < 3)) {
    add("corners", "needs at least 3 corners.");
    return;
  }
  if (sectorVertices(sector).some((id) => !map.vertices[id])) {
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
  const lines = new Set(
    sectorDetails(sector).map(({ from, to }) => edgeKey(from, to)),
  );
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const keys = [edges[i], edges[j]].map(({ from, to }) =>
        edgeKey(from, to),
      );
      if (keys[0] === keys[1] || !wallsMeet(map, edges[i], edges[j])) continue;
      const line = keys.find((key) => lines.has(key));
      if (line && !lines.has(keys[0] === line ? keys[1] : keys[0])) {
        issues.push({
          id: `line-wall:${line}`,
          message: `${sector.name} has a line running along one of its walls.`,
          target: line,
        });
        return;
      }
      add("twist", "has walls that cross or run along each other.");
      return;
    }
  }

  const holes = sectorHoles(map, sector);
  if (holes.some((hole) => Math.abs(signedArea(hole)) < 1)) {
    add("pillar-area", "has a pillar with no area.");
  }
  const details = sector.details ?? [];
  if (details.length > 0 && sector.door) {
    add("line-door-room", "a door can't hold a line.");
    return;
  }
  if (details.some((chain) => chain.length < 2)) {
    add("line-short", "has a line with only one end.");
    return;
  }
  if (sectorDetails(sector).some(({ from, to }) => from === to)) {
    add("line-length", "has a line with no length.");
    return;
  }
  const outerWalls = new Set(
    loopEdges(sector.vertices).map(({ from, to }) => edgeKey(from, to)),
  );
  const corners = new Set(sector.vertices);
  const pillars = sector.holes ?? [];
  for (const [index, hole] of pillars.entries()) {
    if (
      loopEdges(hole).some(({ from, to }) => outerWalls.has(edgeKey(from, to)))
    ) {
      add("pillar-wall", "has a pillar on one of its walls.");
      return;
    }
    if (
      hole.some(
        (id) => !corners.has(id) && !pointInPolygon(map.vertices[id], polygon),
      )
    ) {
      add("pillar-outside", "has a pillar outside its walls.");
      return;
    }
    const shared = new Set(hole);
    for (const other of pillars.slice(index + 1)) {
      if (
        other.some(
          (id) =>
            !shared.has(id) && pointInPolygon(map.vertices[id], holes[index]),
        )
      ) {
        add("pillar-overlap", "has pillars that overlap.");
        return;
      }
    }
  }
}

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Two walls from one corner can still run along each other, which a crossing
// test on their other corners misses.
function wallsMeet(map: GameMap, a: Wall, b: Wall) {
  if (!sharesCorner(a, b)) {
    return segmentsIntersect(
      map.vertices[a.from],
      map.vertices[a.to],
      map.vertices[b.from],
      map.vertices[b.to],
    );
  }
  const shared = a.from === b.from || a.from === b.to ? a.from : a.to;
  const free = (wall: Wall) =>
    map.vertices[wall.from === shared ? wall.to : wall.from];
  return (
    onSegment(map.vertices[b.from], map.vertices[b.to], free(a)) ||
    onSegment(map.vertices[a.from], map.vertices[a.to], free(b))
  );
}

function sharesCorner(a: Wall, b: Wall) {
  return (
    a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to
  );
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
      if (wallsMeet(map, a, b)) {
        const sector = defined(usage.get(a.key))[0];
        issues.push({
          id: `cross:${a.key}:${b.key}`,
          message: `${sector.name}: a wall touches, crosses or runs along another wall.`,
          target: sector.id,
        });
      }
    }
  }

  // A line drawn inside a room lies on no wall and stays inside its room. It
  // may end on a corner of the room, of a pillar or of a room drawn inside.
  const loopWalls = new Map<string, Sector>();
  const nestedCorners = new Map<string, Set<string>>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorLoops(sector).flatMap(loopEdges)) {
      loopWalls.set(edgeKey(from, to), sector);
    }
    const container = containerOf(map, sector);
    if (!container) continue;
    const corners = nestedCorners.get(container.id) ?? new Set<string>();
    for (const id of sector.vertices) corners.add(id);
    nestedCorners.set(container.id, corners);
  }
  const detailOwners = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    const corners = new Set(sectorLoops(sector).flat());
    const inside = (id: string, point: Point) =>
      corners.has(id) ||
      nestedCorners.get(sector.id)?.has(id) ||
      sectorAt(map, point) === sector;
    for (const { from, to } of sectorDetails(sector)) {
      const key = edgeKey(from, to);
      detailOwners.set(key, [...(detailOwners.get(key) ?? []), sector]);
      const other = loopWalls.get(key);
      if (other) {
        issues.push({
          id: `line-wall:${key}`,
          message: `${sector.name} has a line on a wall of ${other.name}.`,
          target: key,
        });
        continue;
      }
      const a = map.vertices[from];
      const b = map.vertices[to];
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (
        !inside(from, a) ||
        !inside(to, b) ||
        sectorAt(map, middle) !== sector
      ) {
        issues.push({
          id: `line-outside:${key}`,
          message: `${sector.name} has a line outside its walls.`,
          target: key,
        });
      }
    }
  }
  for (const [key, owners] of detailOwners) {
    if (owners.length < 2) continue;
    issues.push({
      id: `line-shared:${key}`,
      message: `${owners.map((sector) => sector.name).join(", ")} all draw the same line.`,
      target: key,
    });
  }

  // Two rooms on the same side of one wall both claim the floor beside it,
  // unless one is drawn against a pillar in the other and covers that side.
  const facing = new Map<
    string,
    { sector: Sector; from: string; pillar: boolean }[]
  >();
  for (const sector of map.sectors) {
    sectorLoops(sector).forEach((loop, at) => {
      const clockwise = signedArea(loopPolygon(map, loop)) < 0;
      const oriented = (at > 0 ? clockwise : !clockwise)
        ? loop.toReversed()
        : loop;
      for (const { from, to } of loopEdges(oriented)) {
        const key = edgeKey(from, to);
        facing.set(key, [
          ...(facing.get(key) ?? []),
          { sector, from, pillar: at > 0 },
        ]);
      }
    });
  }
  for (const [key, sides] of facing) {
    const [a, b] = sides;
    if (!b || a.from !== b.from) continue;
    const covered = (room: typeof a, pillar: typeof a) =>
      pillar.pillar && containerOf(map, room.sector) === pillar.sector;
    if (covered(a, b) || covered(b, a)) continue;
    issues.push({
      id: `same-side:${key}`,
      message: `${a.sector.name} and ${b.sector.name} are on the same side of one wall.`,
      target: b.sector.id,
    });
  }

  // A room drawn wholly inside another is fine, and so is one inside a
  // pillar, which is empty space. Anything in between is two rooms fighting
  // over the same floor.
  const nearSectors = nearby(
    map.sectors.map((sector) => boxOf(sectorPolygon(map, sector))),
  );
  for (const [index, sector] of map.sectors.entries()) {
    const polygon = sectorPolygon(map, sector);
    const holes = sectorHoles(map, sector);
    const corners = new Set(sectorVertices(sector));
    const own = new Set(
      sectorLoops(sector)
        .flatMap(loopEdges)
        .map(({ from, to }) => edgeKey(from, to)),
    );
    for (const other of nearSectors(index).map((near) => map.sectors[near])) {
      const overlap = () =>
        issues.push({
          id: `overlap:${sector.id}:${other.id}`,
          message: `${other.name} overlaps ${sector.name}.`,
          target: other.id,
        });
      // Two rooms can share every corner where their walls cross and still
      // lie over each other: then some of the other room's walls run through
      // this room's floor and some don't.
      const loose = loopEdges(other.vertices).filter(
        ({ from, to }) => !own.has(edgeKey(from, to)),
      );
      const through = loose.filter(({ from, to }) => {
        const a = map.vertices[from];
        const b = map.vertices[to];
        return pointInSector(map, sector, {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
      });
      if (through.length > 0 && through.length < loose.length) {
        overlap();
        continue;
      }
      const free = other.vertices
        .filter((id) => !corners.has(id))
        .map((id) => map.vertices[id]);
      const inside = free.filter((point) => pointInPolygon(point, polygon));
      if (inside.length === 0) continue;
      if (inside.length < free.length) {
        overlap();
        continue;
      }
      const inHoles = free.filter((point) =>
        holes.some((hole) => pointInPolygon(point, hole)),
      );
      if (inHoles.length === free.length) continue;
      if (inHoles.length > 0) {
        overlap();
        continue;
      }
      const otherCorners = new Set(sectorVertices(other));
      const otherPolygon = sectorPolygon(map, other);
      if (
        (sector.holes ?? []).some((hole) =>
          hole.some(
            (id) =>
              !otherCorners.has(id) &&
              pointInPolygon(map.vertices[id], otherPolygon),
          ),
        )
      ) {
        issues.push({
          id: `pillar-inside:${sector.id}:${other.id}`,
          message: `A pillar in ${sector.name} is inside ${other.name}.`,
          target: sector.id,
        });
      }
    }
  }
}

// Imported maps have thousands of walls, so each wall or room is only
// compared with the ones whose bounds meet its own.
function nearby(boxes: Box[]) {
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

const maxCells = 4096;

// A box over too many cells, like a far-off corner's wall, meets every box.
function wide(box: Box) {
  const cells = span(box);
  return (
    (cells.right - cells.left + 1) * (cells.bottom - cells.top + 1) > maxCells
  );
}

const gridSize = 256;

function span(box: Box) {
  return {
    left: Math.floor(box.left / gridSize),
    right: Math.floor(box.right / gridSize),
    top: Math.floor(box.top / gridSize),
    bottom: Math.floor(box.bottom / gridSize),
  };
}

function cellsOf(box: Box) {
  const cells = span(box);
  const keys: string[] = [];
  for (let x = cells.left; x <= cells.right; x += 1) {
    for (let y = cells.top; y <= cells.bottom; y += 1) keys.push(`${x},${y}`);
  }
  return keys;
}

function meets(a: Box, b: Box) {
  return (
    a.left <= b.right &&
    a.right >= b.left &&
    a.top <= b.bottom &&
    a.bottom >= b.top
  );
}

const doorClearance = 4;
const playerHeight = 56;

function validateDoors(
  map: GameMap,
  issues: MapIssue[],
  warnings: MapIssue[],
  actions: LineActions,
  opened: Set<number>,
) {
  const owners = wallOwners(map);
  for (const sector of map.sectors) {
    if (!sector.door) continue;
    const add = (kind: string, message: string, list = issues) =>
      list.push({
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
      add(
        "door-low",
        "the rooms beside it are too low for the door to open.",
        warnings,
      );
    }
    if (
      sector.door.opensBy === "switch" &&
      !map.switches.some((item) => item.door === sector.id) &&
      !actions.some((entry) => lineOpensDoor(entry, sector))
    ) {
      add("door-unwired", "connect a switch to open this door.");
    }
    // A door shut on every side still opens when something else moves it. A
    // line with its own action or special gives up the door's, unless that
    // special is a Boom door pressed from the front.
    const fromLines = sectorEdges(sector).some(({ from, to }) => {
      const key = wallKey(from, to);
      const line = map.lines?.[key];
      if ((owners.get(key)?.length ?? 0) < 2 || line?.shut || line?.action) {
        return false;
      }
      return (
        !line?.raw ||
        (getIsGeneralized(line.raw.special) &&
          generalizedTrigger(line.raw.special).trigger === "door")
      );
    });
    if (
      sector.door.opensBy === "use" &&
      !fromLines &&
      !map.switches.some((item) => item.door === sector.id) &&
      !actions.some((entry) => lineOpensDoor(entry, sector)) &&
      !(sector.tag && opened.has(sector.tag))
    ) {
      add("door-shut", "no line opens it from any side.", warnings);
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

// A closed door can't be crossed, and its track walls are out of reach.
function lineOpensDoor(
  { action, line }: ReturnType<typeof activeLineActions>[number],
  door: Sector,
) {
  if (!opensDoor(action.kind)) return false;
  const behind = line.back?.id === door.id;
  if (action.trigger === "door") return behind;
  return (
    action.tag === door.tag &&
    line.front.id !== door.id &&
    !(action.trigger === "walk" && (behind || line.settings.blocksAll))
  );
}

const skills: ThingSkill[] = ["easy", "medium", "hard"];

function validateLines(
  map: GameMap,
  issues: MapIssue[],
  warnings: MapIssue[],
  actions: LineActions,
) {
  for (const { wall, action, line } of actions) {
    const add = (kind: string, message: string, list = issues) =>
      list.push({
        id: `${kind}:${wall}`,
        message: `Line ${line.number}: ${message}`,
        target: wall,
      });
    if (!line.twoSided && action.trigger === "door") {
      add("line-door", "a press-to-open door needs a sector behind the line.");
    } else if (!line.twoSided && action.trigger === "walk") {
      add("line-walk", "nothing can walk over a solid wall.");
    } else if (action.trigger === "door" && !line.doorBehind) {
      add("line-doorless", doorlessMessage(line), warnings);
    }
    if (action.key) {
      const kinds = keyThings[action.key];
      const keys = map.things.filter((thing) => kinds.includes(thing.kind));
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
      add(
        "line-target",
        getIsTeleport(action.kind)
          ? "choose where it teleports to."
          : "choose the sector this action moves.",
      );
    } else if (!map.sectors.some((sector) => sector.tag === action.tag)) {
      add("line-tag", "the sector this action moves no longer has its tag.");
    } else if (action.kind === "floor-raise") {
      const stuck = map.sectors.flatMap((sector) =>
        sector.tag === action.tag ? stuckFloor(map, sector) : [],
      );
      if (stuck.length > 0) add("line-stuck", stuck.join(" "), warnings);
    } else if (
      getIsTeleport(action.kind) &&
      !map.sectors.some(
        (sector) =>
          sector.tag === action.tag &&
          map.things.some(
            (thing) =>
              thing.kind === "teleport-destination" &&
              sectorAt(map, thing) === sector,
          ),
      )
    ) {
      add(
        "line-teleport",
        "place a teleport destination in the sector it teleports to.",
      );
    }
  }
}

// A floor raise goes to the lowest ceiling around the sector, or its own if
// lower, and a door counts at its closed height, which is its floor. The
// engine moves the floor there even when that's below it.
function stuckFloor(map: GameMap, sector: Sector) {
  const [lowest] = [...neighbours(map, sector), sector]
    .map((other) => ({
      other,
      height: other.door ? other.floor : other.ceiling,
    }))
    .sort((a, b) => a.height - b.height);
  if (lowest.height > sector.floor) return [];
  const { other, height } = lowest;
  const at = `${other.door ? "closed " : ""}at ${height}`;
  const where =
    other === sector
      ? `its own ceiling, ${at}`
      : `the lowest ceiling next to it, ${other.name}, ${at}`;
  return [
    height === sector.floor
      ? `the floor of ${sector.name} can't rise: it stops at ${where}.`
      : `the floor of ${sector.name} drops instead of rising: it goes to ${where}.`,
  ];
}

function neighbours(map: GameMap, sector: Sector) {
  const found = new Set<Sector>();
  for (const owners of wallOwners(map).values()) {
    if (!owners.includes(sector)) continue;
    for (const other of owners) if (other !== sector) found.add(other);
  }
  return [...found];
}

// The engine moves the ceiling of whatever is behind a pressed door line, and
// a WAD made elsewhere may mean it to: a door that starts open is one.
function doorlessMessage({ front, back }: ReturnType<typeof describeLine>) {
  const room = back === front ? "this room" : (back?.name ?? "the room behind");
  return `pressing it moves the ceiling of ${room} like a door. If that isn't meant, ${
    back === front ? "" : `make ${room} a door or `
  }choose another trigger.`;
}

// A map set to one engine's compatibility can't use what a later one added,
// and a Boom special on a wall nothing can cross or press from behind does
// nothing. Lines are numbered only once every room is whole, since numbering
// reads the walls.
function validateLevels(
  map: GameMap,
  issues: MapIssue[],
  warnings: MapIssue[],
  whole: boolean,
) {
  const level = map.complevel ?? "vanilla";
  const needs = (
    id: string,
    name: string,
    target: string,
    needed: Complevel,
  ) => {
    if (atLeast(level, needed)) return;
    issues.push({
      id,
      message: `${name}: needs ${complevelLabels[needed]} compatibility, but the map is set to ${complevelLabels[level]}.`,
      target,
    });
  };
  const owners = whole ? wallOwners(map) : null;
  const entries = owners ? [...owners] : [];
  for (const [wall, line] of Object.entries(map.lines ?? {})) {
    const special = line.raw?.special ?? 0;
    const flags = line.passUse ? linePassUse : 0;
    const owner = owners?.get(wall)?.[0];
    const info = owner ? describeLine(map, wall, owner.id, entries) : null;
    const number = info?.number ?? wall;
    needs(
      `line-level:${wall}`,
      `Line ${number}`,
      wall,
      lineLevel(special, flags),
    );
    const kind = generalizedKind(special);
    if (!info || !kind) continue;
    const { trigger } = generalizedTrigger(special);
    if (!info.twoSided && (trigger === "door" || trigger === "walk")) {
      issues.push({
        id: `line-${trigger}:${wall}`,
        message: `Line ${number}: ${
          trigger === "door"
            ? "a press-to-open door needs a sector behind the line."
            : "nothing can walk over a solid wall."
        }`,
        target: wall,
      });
    } else if (
      trigger === "door" &&
      getIsDoorClass(kind) &&
      !info.doorBehind &&
      !line.action
    ) {
      warnings.push({
        id: `line-doorless:${wall}`,
        message: `Line ${number}: ${doorlessMessage(info)}`,
        target: wall,
      });
    } else if (trigger !== "door" && !line.raw?.tag && !line.action) {
      // Boom works a switch, a walk-over or a shot only on tagged sectors.
      warnings.push({
        id: `line-target:${wall}`,
        message: `Line ${number}: it does nothing until it has a sector to act on.`,
        target: wall,
      });
    }
  }
  for (const sector of map.sectors) {
    if (sector.rawEffect === undefined) continue;
    needs(
      `sector-level:${sector.id}`,
      sector.name,
      sector.id,
      sectorLevel(sector.rawEffect),
    );
  }
  for (const thing of map.things) {
    const needed: Complevel = thing.friendly
      ? "mbf"
      : thing.notDeathmatch || thing.notCoop
        ? "boom"
        : "vanilla";
    needs(`thing-level:${thing.id}`, thing.id, thing.id, needed);
  }
}

// The engine stops on a texture or thing the game's IWAD doesn't have.
function validateGame(
  map: GameMap,
  issues: MapIssue[],
  { game, names }: CheckContext,
) {
  if (names) {
    const walls = new Set(names.textures);
    const flats = new Set(names.flats);
    const where = game ? game.label : "the game";
    const missing = (
      id: string,
      name: string,
      texture: string,
      target: string,
    ) =>
      issues.push({
        id,
        message: `${name}: ${where} has no texture called ${texture}.`,
        target,
      });
    for (const sector of map.sectors) {
      const flat = [sector.floorTexture, sector.ceilingTexture].find(
        (texture) => !flats.has(texture),
      );
      const wall = [
        sector.wallTexture,
        ...Object.values(sector.wallOverrides ?? {}),
        ...(sector.door ? [sector.door.texture] : []),
      ].find((texture) => !walls.has(texture));
      const texture = flat ?? wall;
      if (texture) {
        missing(
          `texture-missing:${sector.id}`,
          sector.name,
          texture,
          sector.id,
        );
      }
    }
    for (const [wall, line] of Object.entries(map.lines ?? {})) {
      const texture = Object.values(line.sides ?? {})
        .flatMap((side) => [side.upper, side.lower, side.middle])
        .find((name) => name !== undefined && !walls.has(name));
      if (texture) missing(`texture-missing:${wall}`, "A line", texture, wall);
    }
    for (const item of map.switches) {
      if (!walls.has(item.texture)) {
        missing(
          `texture-missing:${item.id}`,
          `Switch ${item.id}`,
          item.texture,
          item.id,
        );
      }
    }
  }
  if (game && !game.doom2) {
    for (const thing of map.things) {
      if (!thingCatalog[thing.kind].doom2) continue;
      issues.push({
        id: `thing-game:${thing.id}`,
        message: `${thingCatalog[thing.kind].label} isn't in ${game.label}.`,
        target: thing.id,
      });
    }
  }
}
