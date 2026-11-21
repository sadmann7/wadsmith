import earcut from "earcut";

import {
  doorTextures,
  sectorEffects,
  switchTextures,
  thingCatalog,
  thingKinds,
} from "../map/catalog";
import { freedoomFlats, freedoomWalls } from "../map/freedoom-textures";
import { pointInPolygon, signedArea, wallKey } from "../map/geometry";
import {
  lineActionKinds,
  lineActions,
  lineUsesTag,
  usedFromFront,
} from "../map/lines";
import type {
  DoorSettings,
  GameMap,
  LineAction,
  LineSettings,
  LineSide,
  MapSwitch,
  Point,
  Sector,
  SectorEffect,
  Thing,
  ThingKind,
  ThingSkill,
} from "../map/types";
import type { DoomMap } from "./read-map";

type ImportReport = {
  rooms: number;
  splitSectors: number;
  skippedSectors: number;
  droppedThings: Record<string, number>;
  multiplayerThings: number;
  outsideThings: number;
  droppedActions: Record<string, number>;
  droppedEffects: number;
  replacedTextures: string[];
  seeThroughWalls: number;
  innerLines: number;
  plainDoors: number;
  solidSectors: number;
};

type Edge = { from: number; to: number };

const lineBlocksAll = 0x0001;
const lineBlocksEnemies = 0x0002;
const lineUpperUnpegged = 0x0008;
const lineLowerUnpegged = 0x0010;
const lineHidden = 0x0080;
const thingMultiplayer = 0x0010;
const thingAmbush = 0x0008;
const skillFlags: [ThingSkill, number][] = [
  ["easy", 0x0001],
  ["medium", 0x0002],
  ["hard", 0x0004],
];
const doorOpenGap = 4;
const fallbackDoorHeight = 72;
const fallbackWall = "STARTAN3";
const fallbackFloor = "FLOOR4_8";
const fallbackCeiling = "CEIL3_5";
const noTexture = "-";

// The engine raises these doors from the sector behind the line that's used.
const manualDoors: Record<number, boolean> = {
  1: true,
  26: true,
  27: true,
  28: true,
  117: true,
  31: false,
  32: false,
  33: false,
  34: false,
  118: false,
};
const keyedManualDoors = new Set([26, 27, 28, 32, 33, 34]);

const crushers = new Set([6, 25, 49, 73, 74, 77, 141, 57]);
const stairs = new Set([7, 8, 100, 127]);
const lights = new Set([12, 13, 17, 35, 79, 80, 81, 104, 138, 139]);
const secretExits = new Set([51, 124]);
const scrollers = new Set([48]);

function actionGroup(special: number) {
  if (crushers.has(special)) return "Crushers";
  if (stairs.has(special)) return "Stairs";
  if (lights.has(special)) return "Light changes";
  if (secretExits.has(special)) return "Secret exits";
  if (scrollers.has(special)) return "Scrolling walls";
  if (special > 141) return "Boom and later actions";
  return "Other floor, ceiling and door actions";
}

function actionTable() {
  const table = new Map<number, Omit<LineAction, "tag">>();
  for (const kind of lineActionKinds) {
    const definition = lineActions[kind];
    const add = (
      trigger: LineAction["trigger"],
      specials: { once?: number; repeat?: number },
      key?: LineAction["key"],
    ) => {
      if (specials.once !== undefined) {
        table.set(specials.once, { kind, trigger, repeat: false, key });
      }
      if (specials.repeat !== undefined) {
        table.set(specials.repeat, { kind, trigger, repeat: true, key });
      }
    };
    for (const [trigger, specials] of Object.entries(definition.triggers)) {
      add(trigger as LineAction["trigger"], specials);
    }
    for (const [trigger, colors] of Object.entries(definition.keys ?? {})) {
      for (const [key, specials] of Object.entries(colors)) {
        add(
          trigger as LineAction["trigger"],
          specials,
          key as LineAction["key"],
        );
      }
    }
  }
  return table;
}

const actions = actionTable();
const effects = new Map(
  Object.entries(sectorEffects).map(([effect, { special }]) => [
    special,
    effect as SectorEffect,
  ]),
);
const thingKindOf = new Map<number, ThingKind>(
  thingKinds.map((kind) => [thingCatalog[kind].doomType, kind]),
);
const walls = new Set<string>(freedoomWalls);
const flats = new Set<string>(freedoomFlats);

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Keeping the sector on the right and turning as far right as possible walks
// the smallest outline around it, so a sector that touches itself at a corner
// comes back as two outlines.
function traceLoops(edges: Edge[], points: Point[]) {
  const outgoing = new Map<number, Edge[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const used = new Set<Edge>();
  const loops: number[][] = [];
  let broken = false;
  for (const first of edges) {
    if (used.has(first)) continue;
    const loop: number[] = [];
    let edge = first;
    let closed = false;
    for (let step = 0; step <= edges.length; step += 1) {
      used.add(edge);
      loop.push(edge.from);
      const from = points[edge.from];
      const at = points[edge.to];
      const inX = at.x - from.x;
      const inY = at.y - from.y;
      let next: Edge | null = null;
      let best = Infinity;
      for (const option of outgoing.get(edge.to) ?? []) {
        if (used.has(option) && option !== first) continue;
        const to = points[option.to];
        const outX = to.x - at.x;
        const outY = to.y - at.y;
        const turn = Math.atan2(
          inX * outY - inY * outX,
          inX * outX + inY * outY,
        );
        if (turn < best) {
          best = turn;
          next = option;
        }
      }
      if (!next) break;
      if (next === first) {
        closed = true;
        break;
      }
      edge = next;
    }
    if (closed) loops.push(...splitRepeats(loop));
    else broken = true;
  }
  return { loops, broken };
}

function splitRepeats(loop: number[]): number[][] {
  const seen = new Map<number, number>();
  for (const [index, vertex] of loop.entries()) {
    const earlier = seen.get(vertex);
    if (earlier !== undefined) {
      return [
        ...splitRepeats(loop.slice(earlier, index)),
        ...splitRepeats([...loop.slice(0, earlier), ...loop.slice(index)]),
      ];
    }
    seen.set(vertex, index);
  }
  return loop.length >= 3 ? [loop] : [];
}

function areaOf(loop: number[], points: Point[]) {
  return signedArea(loop.map((index) => points[index]));
}

function holeInside(hole: number[], outer: number[], points: Point[]) {
  const polygon = outer.map((index) => points[index]);
  const shared = new Set(outer);
  const free = hole.filter((index) => !shared.has(index));
  if (free.length === 0) {
    const center = {
      x: hole.reduce((sum, index) => sum + points[index].x, 0) / hole.length,
      y: hole.reduce((sum, index) => sum + points[index].y, 0) / hole.length,
    };
    return pointInPolygon(center, polygon);
  }
  return free.every((index) => pointInPolygon(points[index], polygon));
}

function cornerAngle(at: Point, p: Point, q: Point) {
  const ux = p.x - at.x;
  const uy = p.y - at.y;
  const vx = q.x - at.x;
  const vy = q.y - at.y;
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

function counterClockwise(polygon: number[], points: Point[]) {
  return areaOf(polygon, points) < 0 ? polygon.toReversed() : polygon;
}

// Earcut cuts a sector with holes into triangles, then neighbors merge back
// across their thinnest cuts first, so the cuts that remain are well shaped.
function cutHoles(outer: number[], holes: number[][], points: Point[]) {
  const order = [outer, ...holes].flat();
  const holeStarts: number[] = [];
  let count = outer.length;
  for (const hole of holes) {
    holeStarts.push(count);
    count += hole.length;
  }
  const flat = order.flatMap((index) => [points[index].x, points[index].y]);
  const corners = earcut(flat, holeStarts);
  let pieces: number[][] = [];
  for (let index = 0; index < corners.length; index += 3) {
    const triangle = corners
      .slice(index, index + 3)
      .map((corner) => order[corner]);
    if (new Set(triangle).size < 3) continue;
    if (Math.abs(areaOf(triangle, points)) < 0.5) continue;
    pieces.push(
      addCornersOnEdges(counterClockwise(triangle, points), order, points),
    );
  }

  const outline = new Set(
    [outer, ...holes].flatMap((loop) =>
      loop.map((vertex, index) =>
        wallKey(String(vertex), String(loop[(index + 1) % loop.length])),
      ),
    ),
  );
  const cuts = new Map<string, { from: number; to: number; score: number }>();
  for (const triangle of pieces) {
    if (triangle.length !== 3) continue;
    triangle.forEach((from, index) => {
      const to = triangle[(index + 1) % 3];
      const third = triangle[(index + 2) % 3];
      const key = wallKey(String(from), String(to));
      if (outline.has(key)) return;
      const score = Math.min(
        cornerAngle(points[from], points[to], points[third]),
        cornerAngle(points[to], points[from], points[third]),
      );
      cuts.set(key, {
        from,
        to,
        score: Math.min(cuts.get(key)?.score ?? Infinity, score),
      });
    });
  }
  const merged: (number[] | null)[] = pieces;
  const owner = new Map<string, number>();
  const own = (index: number) =>
    merged[index]!.forEach((from, at, piece) =>
      owner.set(`${from}>${piece[(at + 1) % piece.length]}`, index),
    );
  merged.forEach((_, index) => own(index));
  for (const cut of [...cuts.values()].toSorted((a, b) => a.score - b.score)) {
    const first = owner.get(`${cut.to}>${cut.from}`);
    const second = owner.get(`${cut.from}>${cut.to}`);
    if (first === undefined || second === undefined || first === second) {
      continue;
    }
    const join = joinPieces(merged[first]!, merged[second]!, cut.from, cut.to);
    if (!join || new Set(join).size !== join.length) continue;
    merged[first] = join;
    merged[second] = null;
    owner.delete(`${cut.to}>${cut.from}`);
    owner.delete(`${cut.from}>${cut.to}`);
    own(first);
  }
  pieces = merged.filter((piece) => piece !== null);
  return pieces;
}

// Earcut skips corners that sit in a straight line along a wall, so they go
// back into the triangles' edges and neighbors share the same corners.
function addCornersOnEdges(
  piece: number[],
  corners: number[],
  points: Point[],
) {
  return piece.flatMap((from, index) => {
    const to = piece[(index + 1) % piece.length];
    const a = points[from];
    const b = points[to];
    const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const along = corners
      .filter((corner) => {
        if (piece.includes(corner)) return false;
        const c = points[corner];
        if (cross(a, b, c) !== 0) return false;
        const t = (c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y);
        return t > 0 && t < length;
      })
      .toSorted(
        (p, q) =>
          (points[p].x - a.x) ** 2 +
          (points[p].y - a.y) ** 2 -
          ((points[q].x - a.x) ** 2 + (points[q].y - a.y) ** 2),
      );
    return [from, ...along];
  });
}

// `first` runs to -> from along the shared edge and `second` runs from -> to.
function joinPieces(
  first: number[],
  second: number[],
  from: number,
  to: number,
) {
  const start = first.indexOf(from);
  const end = second.indexOf(to);
  if (start < 0 || end < 0) return null;
  const firstPart = [...first.slice(start), ...first.slice(0, start)];
  const secondPart = [...second.slice(end), ...second.slice(0, end)];
  if (firstPart.at(-1) !== to || secondPart.at(-1) !== from) return null;
  return [...firstPart.slice(0, -1), ...secondPart.slice(0, -1)];
}

// One sector can hold two doors apart, but pieces cut from one door would
// touch, and the engine can't open a door into another door.
function piecesTouch(pieces: number[][]) {
  const seen = new Set<string>();
  for (const piece of pieces) {
    const own = piece.map((from, index) =>
      wallKey(String(from), String(piece[(index + 1) % piece.length])),
    );
    if (own.some((key) => seen.has(key))) return true;
    own.forEach((key) => seen.add(key));
  }
  return false;
}

function isSwitch(name: string) {
  return /^SW[12]/.test(name);
}

function mostCommon(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
}

function decompileMap(doom: DoomMap): { map: GameMap; report: ImportReport } {
  const report: ImportReport = {
    rooms: 0,
    splitSectors: 0,
    skippedSectors: 0,
    droppedThings: {},
    multiplayerThings: 0,
    outsideThings: 0,
    droppedActions: {},
    droppedEffects: 0,
    replacedTextures: [],
    seeThroughWalls: 0,
    innerLines: 0,
    plainDoors: 0,
    solidSectors: 0,
  };
  const replaced = new Set<string>();
  const wall = (name: string, fallback = fallbackWall) => {
    if (walls.has(name)) return name;
    replaced.add(name);
    return fallback;
  };
  const switchTexture = (name: string) => {
    if ((switchTextures as readonly string[]).includes(name)) {
      return name as MapSwitch["texture"];
    }
    replaced.add(name);
    return switchTextures[0];
  };
  const flat = (name: string, fallback: string) => {
    if (flats.has(name)) return name;
    replaced.add(name);
    return fallback;
  };

  const sameSpot = new Map<string, number>();
  const canonical = doom.vertices.map((point, index) => {
    const key = `${point.x},${point.y}`;
    if (!sameSpot.has(key)) sameSpot.set(key, index);
    return sameSpot.get(key)!;
  });
  const points = doom.vertices;
  const sectorOf = (side: number | null) =>
    side === null ? null : doom.sides[side].sector;

  const lines = doom.lines.flatMap((line) => {
    if (line.start >= points.length || line.end >= points.length) return [];
    const start = canonical[line.start];
    const end = canonical[line.end];
    const front = sectorOf(line.front);
    const back = sectorOf(line.back);
    if (start === end || front === null || front >= doom.sectors.length) {
      return [];
    }
    if (back !== null && back >= doom.sectors.length) return [];
    if (front === back) {
      report.innerLines += 1;
      return [];
    }
    return [{ ...line, start, end, frontSector: front, backSector: back }];
  });

  const sectorEdges = doom.sectors.map((): Edge[] => []);
  for (const line of lines) {
    sectorEdges[line.frontSector].push({ from: line.start, to: line.end });
    if (line.backSector !== null) {
      sectorEdges[line.backSector].push({ from: line.end, to: line.start });
    }
  }

  const pieces = doom.sectors.map((_, index) => {
    const { loops, broken } = traceLoops(sectorEdges[index], points);
    if (broken || loops.length === 0) {
      if (sectorEdges[index].length > 0) report.skippedSectors += 1;
      return [];
    }
    const outers = loops
      .filter((loop) => areaOf(loop, points) < -0.5)
      .toSorted(
        (a, b) => Math.abs(areaOf(a, points)) - Math.abs(areaOf(b, points)),
      );
    const holes = new Map<number[], number[][]>(
      outers.map((loop) => [loop, []]),
    );
    for (const loop of loops) {
      if (areaOf(loop, points) <= 0.5) continue;
      const host = outers.find((outer) => holeInside(loop, outer, points));
      if (host) holes.get(host)!.push(loop);
    }
    const result = outers.flatMap((outer) => {
      const inner = holes.get(outer)!;
      if (inner.length === 0) return [outer];
      return cutHoles(outer, inner, points);
    });
    if (result.length > 1) report.splitSectors += 1;
    return result;
  });

  const doorCandidates = new Map<number, DoorSettings["opensBy"] | null>();
  const doorCloses = new Map<number, boolean>();
  for (const line of lines) {
    const closes = manualDoors[line.special];
    if (closes !== undefined && line.backSector !== null) {
      doorCandidates.set(line.backSector, "use");
      doorCloses.set(line.backSector, closes);
    }
  }
  for (const line of lines) {
    const action = actions.get(line.special);
    if (
      !action ||
      action.trigger === "door" ||
      (action.kind !== "door-raise" && action.kind !== "door-open") ||
      line.tag === 0
    ) {
      continue;
    }
    doom.sectors.forEach((sector, index) => {
      if (sector.tag !== line.tag || doorCandidates.get(index) === "use")
        return;
      doorCandidates.set(index, "switch");
      doorCloses.set(index, action.kind === "door-raise");
    });
  }

  const neighbors = doom.sectors.map(() => new Set<number>());
  for (const line of lines) {
    if (line.backSector === null) continue;
    neighbors[line.frontSector].add(line.backSector);
    neighbors[line.backSector].add(line.frontSector);
  }
  const doors = new Set<number>();
  for (const [index, opensBy] of doorCandidates) {
    const sector = doom.sectors[index];
    if (!opensBy || sector.ceiling > sector.floor) continue;
    if (piecesTouch(pieces[index])) {
      report.plainDoors += 1;
      continue;
    }
    if ([...neighbors[index]].some((other) => doors.has(other))) {
      report.plainDoors += 1;
      continue;
    }
    doors.add(index);
  }

  // A closed sector that nothing opens looks like solid wall, so it becomes
  // empty space and its neighbors get plain walls.
  const openedTags = new Set<number>();
  const openedByUse = new Set<number>();
  for (const line of lines) {
    const action = actions.get(line.special);
    if (!action || action.kind === "exit") continue;
    if (action.trigger === "door") {
      if (line.backSector !== null) openedByUse.add(line.backSector);
    } else if (line.tag) {
      openedTags.add(line.tag);
    }
  }
  doom.sectors.forEach((sector, index) => {
    if (doors.has(index) || sector.ceiling > sector.floor) return;
    if (sector.tag && openedTags.has(sector.tag)) return;
    if (openedByUse.has(index)) return;
    if (pieces[index].length > 0) report.solidSectors += 1;
    pieces[index] = [];
  });

  const ids = pieces.map((list, index) =>
    list.map((_, part) =>
      list.length > 1 ? `s${index}-${part + 1}` : `s${index}`,
    ),
  );
  const edgeOwner = new Map<string, { sector: number; id: string }>();
  pieces.forEach((list, sector) =>
    list.forEach((loop, part) =>
      loop.forEach((vertex, at) => {
        const next = loop[(at + 1) % loop.length];
        edgeOwner.set(`${sector}:${wallKey(String(vertex), String(next))}`, {
          sector,
          id: ids[sector][part],
        });
      }),
    ),
  );
  const vertexId = (index: number) => `v${index}`;
  const keyOf = (a: number, b: number) => wallKey(vertexId(a), vertexId(b));
  const pieceAt = (sector: number, a: number, b: number) =>
    edgeOwner.get(`${sector}:${wallKey(String(a), String(b))}`)?.id ?? null;

  const sectors: Sector[] = [];
  const sectorFor = new Map<string, Sector>();
  doom.sectors.forEach((source, index) => {
    if (pieces[index].length === 0) return;
    const ownLines = lines.filter(
      (line) => line.frontSector === index || line.backSector === index,
    );
    const sideOf = (line: (typeof lines)[number]) =>
      doom.sides[line.frontSector === index ? line.front! : line.back!];
    const middles = ownLines
      .filter((line) => line.backSector === null)
      .map((line) => sideOf(line).middle)
      .filter((name) => walls.has(name));
    const parts = ownLines
      .flatMap((line) => [sideOf(line).upper, sideOf(line).lower])
      .filter((name) => walls.has(name));
    const wallTexture =
      mostCommon(middles) ?? mostCommon(parts) ?? fallbackWall;
    const effect = effects.get(source.special);
    if (source.special !== 0 && !effect) report.droppedEffects += 1;

    let door: DoorSettings | undefined;
    let ceiling = Math.max(source.ceiling, source.floor);
    if (doors.has(index)) {
      const uppers = ownLines.map(
        (line) =>
          doom.sides[
            line.frontSector === index
              ? (line.back ?? line.front!)
              : line.front!
          ].upper,
      );
      const upper = mostCommon(uppers.filter((name) => name !== noTexture));
      const texture = (doorTextures as readonly string[]).includes(upper ?? "")
        ? (upper as DoorSettings["texture"])
        : upper?.startsWith("BIGDOOR")
          ? "BIGDOOR2"
          : "DOOR3";
      if (upper && texture !== upper) replaced.add(upper);
      door = {
        opensBy: doorCandidates.get(index)!,
        closes: doorCloses.get(index) ?? true,
        texture,
      };
      const lowest = Math.min(
        ...[...neighbors[index]].map((other) => doom.sectors[other].ceiling),
      );
      ceiling =
        Number.isFinite(lowest) && lowest - doorOpenGap > source.floor
          ? lowest - doorOpenGap
          : source.floor + fallbackDoorHeight;
    }

    pieces[index].forEach((loop, part) => {
      const sector: Sector = {
        id: ids[index][part],
        name:
          pieces[index].length > 1
            ? `Sector ${index} part ${part + 1}`
            : `Sector ${index}`,
        vertices: loop.map(vertexId),
        floor: source.floor,
        ceiling,
        light: Math.min(255, Math.max(0, source.light)),
        floorTexture: flat(source.floorTexture, fallbackFloor),
        ceilingTexture: flat(source.ceilingTexture, fallbackCeiling),
        wallTexture,
        ...(door ? { door } : {}),
        ...(effect ? { effect } : {}),
        ...(source.tag ? { tag: source.tag } : {}),
      };
      sectors.push(sector);
      sectorFor.set(sector.id, sector);
    });
  });
  report.rooms = sectors.length;

  const settings: Record<string, LineSettings> = {};
  const switches: MapSwitch[] = [];
  for (const line of lines) {
    const kept = (
      [
        [line.frontSector, line.front],
        [line.backSector, line.back],
      ] as const
    ).flatMap(([sector, side]) => {
      if (sector === null || side === null) return [];
      const id = pieceAt(sector, line.start, line.end);
      return id ? [{ id, sector, side: doom.sides[side] }] : [];
    });
    if (kept.length === 0) continue;
    const key = keyOf(line.start, line.end);
    const entry: LineSettings = {};
    const sides: Record<string, LineSide> = {};

    if (line.special !== 0) {
      const action = actions.get(line.special);
      const intoDoor = line.backSector !== null && doors.has(line.backSector);
      const automatic =
        intoDoor &&
        manualDoors[line.special] !== undefined &&
        !keyedManualDoors.has(line.special);
      const unreachable =
        kept.length === 1 &&
        (action?.trigger === "walk" || action?.trigger === "door");
      if (action && !automatic && !unreachable) {
        const value = { ...action, tag: 0 };
        if (!value.key) delete value.key;
        entry.action = {
          ...value,
          tag: lineUsesTag(value) ? line.tag : 0,
        };
      } else if (!action && !automatic) {
        const group = actionGroup(line.special);
        report.droppedActions[group] = (report.droppedActions[group] ?? 0) + 1;
      }
    }

    const offsets = (side: (typeof doom.sides)[number]) => ({
      ...(side.offsetX ? { offsetX: side.offsetX } : {}),
      ...(side.offsetY ? { offsetY: side.offsetY } : {}),
    });
    if (kept.length === 2) {
      if (kept.some(({ side }) => side.middle !== noTexture)) {
        report.seeThroughWalls += 1;
      }
      for (const item of kept) {
        const { id, side } = item;
        // The compiler gives the walls above a door the door's own texture.
        const facesDoor = kept.some(
          (other) => other !== item && doors.has(other.sector),
        );
        const value: LineSide = {
          ...offsets(side),
          ...(side.upper !== noTexture && !facesDoor
            ? { upper: wall(side.upper) }
            : {}),
          ...(side.lower !== noTexture ? { lower: wall(side.lower) } : {}),
        };
        if (Object.keys(value).length > 0) sides[id] = value;
      }
      if (line.flags & lineBlocksAll) entry.blocksAll = true;
      if (entry.action && usedFromFront(entry.action)) {
        entry.front = kept[0].id;
      }
    } else {
      const [{ id, side }] = kept;
      const owner = sectorFor.get(id)!;
      const visible = [side.middle, side.upper, side.lower].find(
        (name) => name !== noTexture,
      );
      if (entry.action?.trigger === "switch" && isSwitch(visible ?? "")) {
        const texture = switchTexture(visible!);
        switches.push({
          id: `w${switches.length}`,
          sector: id,
          from: vertexId(line.start),
          to: vertexId(line.end),
          texture,
          door: null,
        });
      } else {
        const name = visible
          ? wall(visible, owner.wallTexture)
          : owner.wallTexture;
        if (name !== owner.wallTexture) {
          owner.wallOverrides = { ...owner.wallOverrides, [key]: name };
        }
      }
      const value = offsets(side);
      if (Object.keys(value).length > 0) sides[id] = value;
    }
    if (line.flags & lineBlocksEnemies) entry.blocksEnemies = true;
    if (line.flags & lineUpperUnpegged) entry.upperFixed = true;
    if (line.flags & lineLowerUnpegged) entry.lowerFixed = true;
    if (line.flags & lineHidden) entry.hidden = true;
    if (Object.keys(sides).length > 0) entry.sides = sides;
    if (Object.keys(entry).length > 0) settings[key] = entry;
  }

  const polygons = sectors.map((sector) =>
    sector.vertices.map((id) => {
      const point = points[Number(id.slice(1))];
      return { x: point.x, y: point.y };
    }),
  );
  const things: Thing[] = [];
  doom.things.forEach((source, index) => {
    const kind = thingKindOf.get(source.type);
    if (!kind) {
      const label = "Other things";
      report.droppedThings[label] = (report.droppedThings[label] ?? 0) + 1;
      return;
    }
    const isStart = source.type >= 1 && source.type <= 4;
    if (!isStart && source.type !== 11 && source.flags & thingMultiplayer) {
      report.multiplayerThings += 1;
      return;
    }
    const skills = skillFlags
      .filter(([, flag]) => source.flags & flag)
      .map(([skill]) => skill);
    if (!isStart && source.type !== 11 && skills.length === 0) {
      report.multiplayerThings += 1;
      return;
    }
    if (!polygons.some((polygon) => pointInPolygon(source, polygon))) {
      report.outsideThings += 1;
      return;
    }
    const enemy = thingCatalog[kind].category === "enemy";
    things.push({
      id: `t${index}`,
      kind,
      x: source.x,
      y: 0 - source.y,
      angle: ((source.angle % 360) + 360) % 360,
      ...(skills.length > 0 && skills.length < 3 ? { skills } : {}),
      ...(enemy && source.flags & thingAmbush ? { ambush: true } : {}),
    });
  });

  const used = new Set(sectors.flatMap((sector) => sector.vertices));
  const vertices = Object.fromEntries(
    [...used].map((id) => {
      const point = points[Number(id.slice(1))];
      return [id, { x: point.x, y: 0 - point.y }];
    }),
  );
  report.replacedTextures = [...replaced].toSorted();
  return {
    map: {
      name: doom.slot,
      vertices,
      sectors,
      things,
      switches,
      ...(Object.keys(settings).length > 0 ? { lines: settings } : {}),
    },
    report,
  };
}

export { decompileMap, type ImportReport };
