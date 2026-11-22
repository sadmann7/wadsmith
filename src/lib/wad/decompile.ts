import type { TextureNames } from "@/lib/map/textures";
import type {
  Complevel,
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
} from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { generalizedTrigger, isGeneralized } from "@/lib/map/boom";
import {
  doorTextures,
  sectorEffects,
  switchTextures,
  thingCatalog,
  thingKinds,
} from "@/lib/map/catalog";
import {
  higherLevel,
  lineLevel,
  sectorLevel,
  thingLevel,
} from "@/lib/map/complevel";
import {
  freedoomFlats,
  freedoomWalls,
  middleTextures,
} from "@/lib/map/freedoom-textures";
import {
  pointInPolygon,
  sectorContainers,
  sectorVertices,
  signedArea,
  wallKey,
} from "@/lib/map/geometry";
import {
  closesDoor,
  doorSpecial,
  isFast,
  lineActionKinds,
  lineActions,
  movesSector,
  opensDoor,
  usedFromFront,
} from "@/lib/map/lines";

import type { DoomMap } from "./read-map";

export interface ImportReport {
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
}

interface Edge {
  from: number;
  to: number;
}

// Openings are holes that other rooms fill, which still bound this one, and
// details are lines with this sector on both sides.
interface Region {
  outer: number[];
  holes: number[][];
  openings: number[][];
  details: number[][];
}

type TracedLine = DoomMap["lines"][number] & {
  frontSector: number;
  backSector: number | null;
};

const lineBlocksAll = 0x0001;
const lineBlocksEnemies = 0x0002;
const lineUpperUnpegged = 0x0008;
const lineLowerUnpegged = 0x0010;
const lineSecret = 0x0020;
const lineSoundBlock = 0x0040;
const lineHidden = 0x0080;
const lineMapped = 0x0100;
const linePassUse = 0x0200;
// Old editors left junk in the high bits and set this one, so the bits past
// vanilla's mean nothing on such a line.
const lineReserved = 0x0800;
const vanillaLineFlags = 0x01ff;
const thingAmbush = 0x0008;
const thingMultiplayer = 0x0010;
const thingNotDeathmatch = 0x0020;
const thingNotCoop = 0x0040;
const thingFriendly = 0x0080;
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
const fastManualDoors = new Set([117, 118]);

const specialScrollLeft = 48;

const actions = actionTable();

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

const effects = new Map(
  Object.entries(sectorEffects).map(([effect, { special }]) => [
    special,
    effect as SectorEffect,
  ]),
);
const thingKindOf = new Map<number, ThingKind>(
  thingKinds.map((kind) => [thingCatalog[kind].doomType, kind]),
);
// Without the game's own names, Freedoom's stand in.
const freedoomNames: TextureNames = {
  walls: freedoomWalls,
  flats: freedoomFlats,
  middles: middleTextures,
  textures: [...middleTextures, ...doorTextures, ...switchTextures],
};

export function decompileMap(
  doom: DoomMap,
  names: TextureNames = freedoomNames,
): { map: GameMap; report: ImportReport } {
  const walls = new Set(names.walls);
  const flats = new Set(names.flats);
  const middles = new Set(names.middles);
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
      return name;
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
    return defined(sameSpot.get(key));
  });
  const points = doom.vertices;
  const sectorOf = (side: number | null) =>
    side === null ? null : doom.sides[side].sector;

  const inner: TracedLine[] = [];
  const lines = doom.lines.flatMap((line): TracedLine[] => {
    if (line.start >= points.length || line.end >= points.length) return [];
    const start = canonical[line.start];
    const end = canonical[line.end];
    const front = sectorOf(line.front);
    const back = sectorOf(line.back);
    if (start === end || front === null || front >= doom.sectors.length) {
      return [];
    }
    if (back !== null && back >= doom.sectors.length) return [];
    const traced = {
      ...line,
      start,
      end,
      frontSector: front,
      backSector: back,
    };
    if (front === back) {
      inner.push(traced);
      return [];
    }
    return [traced];
  });

  const sectorEdges = doom.sectors.map((): Edge[] => []);
  for (const line of lines) {
    sectorEdges[line.frontSector].push({ from: line.start, to: line.end });
    if (line.backSector !== null) {
      sectorEdges[line.backSector].push({ from: line.end, to: line.start });
    }
  }

  // A sector made of separate areas becomes a room for each, and a hole in
  // one belongs to the smallest area around it.
  const pieces = doom.sectors.map((_, index): Region[] => {
    const { loops, broken } = traceLoops(sectorEdges[index], points);
    if (broken || loops.length === 0) {
      if (sectorEdges[index].length > 0) report.skippedSectors += 1;
      return [];
    }
    const regions = loops
      .filter((loop) => areaOf(loop, points) < -0.5)
      .toSorted(
        (a, b) => Math.abs(areaOf(a, points)) - Math.abs(areaOf(b, points)),
      )
      .map((outer): Region => ({
        outer,
        holes: [],
        openings: [],
        details: [],
      }));
    for (const loop of loops) {
      if (areaOf(loop, points) <= 0.5) continue;
      const host = regions.find((region) =>
        holeInside(loop, region.outer, points),
      );
      if (host) host.holes.push(loop);
    }
    if (regions.length > 1) report.splitSectors += 1;
    return regions;
  });

  // A line with its sector on both sides is a detail of the room whose floor
  // it crosses, like a grate or a trip line, and a trip line opens sectors
  // like any other.
  const polygonOf = (loop: number[]) => loop.map((index) => points[index]);
  const details: TracedLine[] = [];
  for (const line of inner) {
    const a = points[line.start];
    const b = points[line.end];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const region = pieces[line.frontSector].find(
      (candidate) =>
        pointInPolygon(middle, polygonOf(candidate.outer)) &&
        ![...candidate.holes, ...candidate.openings].some((loop) =>
          pointInPolygon(middle, polygonOf(loop)),
        ),
    );
    if (!region) {
      report.innerLines += 1;
      continue;
    }
    region.details.push([line.start, line.end]);
    details.push(line);
  }

  const doorCandidates = new Map<number, DoorSettings["opensBy"] | null>();
  const doorCloses = new Map<number, boolean>();
  const doorFast = new Set<number>();
  const manualLines = new Map<number, number[]>();
  for (const line of lines) {
    if (manualDoors[line.special] !== undefined && line.backSector !== null) {
      manualLines.set(line.backSector, [
        ...(manualLines.get(line.backSector) ?? []),
        line.special,
      ]);
    }
  }
  // A door opens the way most of its lines do, and the rest keep their own.
  for (const [index, specials] of manualLines) {
    const plain = specials.filter((special) => !keyedManualDoors.has(special));
    const special = Number(
      mostCommon((plain.length > 0 ? plain : specials).map(String)),
    );
    doorCandidates.set(index, "use");
    doorCloses.set(index, manualDoors[special]);
    if (fastManualDoors.has(special)) doorFast.add(index);
  }
  for (const line of [...lines, ...details]) {
    const action = actions.get(line.special);
    if (
      !action ||
      action.trigger === "door" ||
      !opensDoor(action.kind) ||
      line.tag === 0
    ) {
      continue;
    }
    doom.sectors.forEach((sector, index) => {
      if (sector.tag !== line.tag || doorCandidates.get(index) === "use")
        return;
      doorCandidates.set(index, "switch");
      doorCloses.set(index, closesDoor(action.kind));
      if (isFast(action.kind)) doorFast.add(index);
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
    if (piecesTouch(pieces[index].map((region) => region.outer))) {
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
  // empty space and its neighbors get plain walls. Nothing can walk over a
  // line into solid wall, so each pass can close off more sectors.
  const solid = new Set<number>();
  for (let changed = true; changed;) {
    changed = false;
    const openedTags = new Set<number>();
    const openedByUse = new Set<number>();
    for (const line of [...lines, ...details]) {
      const action = actions.get(line.special);
      if (!action || !movesSector(action.kind)) continue;
      if (action.trigger === "door") {
        if (line.backSector !== null) openedByUse.add(line.backSector);
      } else if (
        line.tag &&
        !(
          action.trigger === "walk" &&
          (line.backSector === null ||
            solid.has(line.frontSector) ||
            solid.has(line.backSector))
        )
      ) {
        openedTags.add(line.tag);
      }
    }
    doom.sectors.forEach((sector, index) => {
      if (solid.has(index) || doors.has(index)) return;
      if (sector.ceiling > sector.floor) return;
      if (sector.tag && openedTags.has(sector.tag)) return;
      if (openedByUse.has(index)) return;
      solid.add(index);
      changed = true;
    });
  }
  for (const index of solid) {
    if (pieces[index].length > 0) report.solidSectors += 1;
    pieces[index] = [];
  }

  // A hole that other rooms fill is just those rooms drawn inside this one,
  // and one with solid wall around any part of it stays a pillar.
  const lineAt = new Map<string, (typeof lines)[number]>();
  for (const line of lines) {
    lineAt.set(wallKey(String(line.start), String(line.end)), line);
  }
  pieces.forEach((regions, index) => {
    for (const region of regions) {
      const pillars: number[][] = [];
      for (const hole of region.holes) {
        const solid = hole.some((vertex, at) => {
          const line = lineAt.get(
            wallKey(String(vertex), String(hole[(at + 1) % hole.length])),
          );
          const other =
            line?.frontSector === index
              ? line.backSector
              : (line?.frontSector ?? null);
          return other === null || pieces[other].length === 0;
        });
        (solid ? pillars : region.openings).push(hole);
      }
      region.holes = pillars;
    }
  });

  const ids = pieces.map((list, index) =>
    list.map((_, part) =>
      list.length > 1 ? `s${index}-${part + 1}` : `s${index}`,
    ),
  );
  const edgeOwner = new Map<string, { sector: number; id: string }>();
  pieces.forEach((list, sector) =>
    list.forEach((region, part) => {
      const own = (a: number, b: number) =>
        edgeOwner.set(`${sector}:${wallKey(String(a), String(b))}`, {
          sector,
          id: ids[sector][part],
        });
      [region.outer, ...region.holes, ...region.openings].forEach((loop) =>
        loop.forEach((vertex, at) => own(vertex, loop[(at + 1) % loop.length])),
      );
      region.details.forEach(([a, b]) => own(a, b));
    }),
  );
  const pieceAt = (sector: number, a: number, b: number) =>
    edgeOwner.get(`${sector}:${wallKey(String(a), String(b))}`)?.id ?? null;

  const sectors: Sector[] = [];
  const sectorFor = new Map<string, Sector>();
  const doorOf = new Map<number, DoorSettings>();
  const doorFaceOf = new Map<number, string>();
  doom.sectors.forEach((source, index) => {
    if (pieces[index].length === 0) return;
    const ownLines = lines.filter(
      (line) => line.frontSector === index || line.backSector === index,
    );
    const sideOf = (line: (typeof lines)[number]) =>
      doom.sides[
        line.frontSector === index ? defined(line.front) : defined(line.back)
      ];
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
    const rawEffect = source.special !== 0 && !effect ? source.special : null;

    let door: DoorSettings | undefined;
    let ceiling = Math.max(source.ceiling, source.floor);
    const lowest = Math.min(
      ...[...neighbors[index]].map((other) => doom.sectors[other].ceiling),
    );
    const opened =
      Number.isFinite(lowest) && lowest - doorOpenGap > source.floor
        ? lowest - doorOpenGap
        : source.floor + fallbackDoorHeight;
    // A door the editor can't hold stays open, so the level can still be played.
    if (doorCandidates.get(index) && source.ceiling <= source.floor) {
      ceiling = opened;
    }
    if (doors.has(index)) {
      const uppers = ownLines.map(
        (line) =>
          doom.sides[
            line.frontSector === index
              ? (line.back ?? defined(line.front))
              : defined(line.front)
          ].upper,
      );
      const upper = mostCommon(uppers.filter((name) => name !== noTexture));
      const texture = (doorTextures as readonly string[]).includes(upper ?? "")
        ? upper
        : upper?.startsWith("BIGDOOR")
          ? "BIGDOOR2"
          : "DOOR3";
      if (upper && texture !== upper) replaced.add(upper);
      door = {
        opensBy: defined(doorCandidates.get(index)),
        closes: doorCloses.get(index) ?? true,
        ...(doorFast.has(index) ? { fast: true } : {}),
        texture,
      };
      doorOf.set(index, door);
      if (upper) doorFaceOf.set(index, upper);
      ceiling = opened;
    }

    pieces[index].forEach((region, part) => {
      const sector: Sector = {
        id: ids[index][part],
        name:
          pieces[index].length > 1
            ? `Sector ${index} part ${part + 1}`
            : `Sector ${index}`,
        vertices: region.outer.map(vertexId),
        ...(region.holes.length > 0
          ? { holes: region.holes.map((hole) => hole.map(vertexId)) }
          : {}),
        ...(region.details.length > 0
          ? { details: region.details.map((chain) => chain.map(vertexId)) }
          : {}),
        floor: source.floor,
        ceiling,
        light: Math.min(255, Math.max(0, source.light)),
        floorTexture: flat(source.floorTexture, fallbackFloor),
        ceilingTexture: flat(source.ceilingTexture, fallbackCeiling),
        wallTexture,
        ...(door ? { door } : {}),
        ...(effect ? { effect } : {}),
        ...(rawEffect === null ? {} : { rawEffect }),
        ...(source.tag ? { tag: source.tag } : {}),
      };
      sectors.push(sector);
      sectorFor.set(sector.id, sector);
    });
  });
  report.rooms = sectors.length;

  // One sector can be two doors apart, opened together by either one's
  // lines. Cut into pieces, a piece with no opening line of its own would
  // never open, so its lines open it instead of staying shut.
  const openedPieces = new Set<string>();
  for (const line of lines) {
    if (line.backSector === null || manualDoors[line.special] === undefined) {
      continue;
    }
    if (!doors.has(line.backSector)) continue;
    const id = pieceAt(line.backSector, line.start, line.end);
    if (id) openedPieces.add(id);
  }

  const settings: Record<string, LineSettings> = {};
  const switches: MapSwitch[] = [];
  for (const line of [...lines, ...details]) {
    const detail = line.frontSector === line.backSector;
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
    const flags =
      line.flags & lineReserved ? line.flags & vanillaLineFlags : line.flags;
    const doorBehind =
      line.backSector === null ? undefined : doorOf.get(line.backSector);
    // The compiler puts a door behind every line into it, whichever side the
    // WAD had it on.
    const doorAt = kept.find(({ sector }) => doors.has(sector));

    if (line.special === specialScrollLeft) {
      entry.scrolls = true;
    } else if (line.special === 0) {
      if (
        kept.length === 2 &&
        doorAt &&
        doorOf.get(doorAt.sector)?.opensBy === "use" &&
        openedPieces.has(doorAt.id)
      ) {
        entry.shut = true;
      }
    } else {
      const action = actions.get(line.special);
      // A line that opens the door the door's own way adds nothing, unless
      // it carries a tag to keep.
      const automatic =
        doorBehind !== undefined &&
        line.special === doorSpecial(doorBehind) &&
        line.tag === 0;
      const trigger = action
        ? action.trigger
        : isGeneralized(line.special)
          ? generalizedTrigger(line.special).trigger
          : null;
      const unreachable =
        kept.length === 1 && (trigger === "walk" || trigger === "door");
      if (action && !automatic && !unreachable) {
        const value = { ...action, tag: line.tag };
        if (!value.key) delete value.key;
        entry.action = value;
      } else if (!action && !automatic && !unreachable) {
        entry.raw = { special: line.special, tag: line.tag };
      }
    }

    const offsets = (side: (typeof doom.sides)[number]) => ({
      ...(side.offsetX ? { offsetX: side.offsetX } : {}),
      ...(side.offsetY ? { offsetY: side.offsetY } : {}),
    });
    if (kept.length === 2) {
      const opening = kept.some(({ sector }) => doors.has(sector));
      if (
        kept.some(
          ({ side }) =>
            side.middle !== noTexture && (opening || !middles.has(side.middle)),
        )
      ) {
        report.seeThroughWalls += 1;
      }
      // The compiler gives every face of a door the door's own texture, so
      // only a face that differs keeps its own.
      const doorFace = kept
        .filter(({ sector }) => doors.has(sector))
        .map(({ sector }) => doorFaceOf.get(sector))[0];
      for (const item of kept) {
        // Both sides of a line inside a room are the room, so the front's
        // textures stand for both.
        if (detail && item !== kept[0]) continue;
        const { id, side } = item;
        const facesDoor = opening && side.upper === doorFace;
        // A switch on an open line keeps its texture so the press still shows,
        // and a door's face can be any door texture.
        const part = (name: string) =>
          entry.action?.trigger === "switch" && isSwitch(name)
            ? switchTexture(name)
            : opening && (doorTextures as readonly string[]).includes(name)
              ? name
              : wall(name);
        const middle =
          side.middle !== noTexture && !opening && middles.has(side.middle)
            ? { middle: side.middle }
            : {};
        const value: LineSide = detail
          ? { ...offsets(side), ...middle }
          : {
              ...offsets(side),
              ...(side.upper !== noTexture && !facesDoor
                ? { upper: part(side.upper) }
                : {}),
              ...(side.lower !== noTexture ? { lower: part(side.lower) } : {}),
              ...middle,
            };
        if (Object.keys(value).length > 0) sides[id] = value;
      }
      if (line.flags & lineBlocksAll) entry.blocksAll = true;
      // The compiler puts a door behind its lines, so their front is set.
      if (
        !opening &&
        (entry.scrolls || (entry.action && usedFromFront(entry.action)))
      ) {
        entry.front = kept[0].id;
      }
    } else {
      const [{ id, side }] = kept;
      const owner = defined(sectorFor.get(id));
      const visible = [side.middle, side.upper, side.lower].find(
        (name) => name !== noTexture,
      );
      const madeSwitch =
        entry.action?.trigger === "switch" && isSwitch(visible ?? "");
      // The compiler pegs door tracks and switch art to the floor unless the
      // line says otherwise.
      if (
        (madeSwitch || doors.has(line.frontSector)) &&
        !(flags & lineLowerUnpegged)
      ) {
        entry.lowerFixed = false;
      }
      if (madeSwitch) {
        const texture = switchTexture(defined(visible));
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
    if (flags & lineBlocksEnemies) entry.blocksEnemies = true;
    if (flags & lineUpperUnpegged) entry.upperFixed = true;
    if (flags & lineLowerUnpegged) entry.lowerFixed = true;
    if (flags & lineSecret) entry.secret = true;
    if (flags & lineSoundBlock) entry.soundBlock = true;
    if (flags & lineHidden) entry.hidden = true;
    if (flags & lineMapped) entry.mapped = true;
    if (flags & linePassUse) entry.passUse = true;
    if (Object.keys(sides).length > 0) entry.sides = sides;
    if (Object.keys(entry).length > 0) settings[key] = entry;
  }

  const doomPoint = (id: string) => points[Number(id.slice(1))];
  const regionsOf = sectors.map((sector) => ({
    outer: sector.vertices.map(doomPoint),
    holes: (sector.holes ?? []).map((hole) => hole.map(doomPoint)),
  }));
  const insideRoom = (point: Point, at: number) =>
    pointInPolygon(point, regionsOf[at].outer) &&
    !regionsOf[at].holes.some((hole) => pointInPolygon(point, hole));
  const things: Thing[] = [];
  doom.things.forEach((source, index) => {
    const kind = thingKindOf.get(source.type);
    if (!kind) {
      const label = "Other things";
      report.droppedThings[label] = (report.droppedThings[label] ?? 0) + 1;
      return;
    }
    const isStart = source.type >= 1 && source.type <= 4;
    const skills = skillFlags
      .filter(([, flag]) => source.flags & flag)
      .map(([skill]) => skill);
    if (!isStart && source.type !== 11 && skills.length === 0) {
      report.multiplayerThings += 1;
      return;
    }
    if (!regionsOf.some((_, at) => insideRoom(source, at))) {
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
      ...(source.flags & thingMultiplayer ? { multiplayer: true } : {}),
      ...(source.flags & thingNotDeathmatch ? { notDeathmatch: true } : {}),
      ...(source.flags & thingNotCoop ? { notCoop: true } : {}),
      ...(enemy && source.flags & thingFriendly ? { friendly: true } : {}),
    });
  });

  // A teleporter whose tagged sector holds no landing at all goes nowhere.
  const landings = new Set(
    things
      .filter((thing) => thing.kind === "teleport-destination")
      .flatMap((thing) =>
        sectors
          .filter(
            (sector, at) =>
              sector.tag !== undefined &&
              insideRoom({ x: thing.x, y: -thing.y }, at),
          )
          .map((sector) => sector.tag),
      ),
  );
  for (const [key, entry] of Object.entries(settings)) {
    const action = entry.action;
    if (
      (action?.kind !== "teleport" && action?.kind !== "teleport-monsters") ||
      landings.has(action.tag)
    ) {
      continue;
    }
    delete entry.action;
    if (Object.keys(entry).length === 0) delete settings[key];
    const group = "Teleporters with nowhere to land";
    report.droppedActions[group] = (report.droppedActions[group] ?? 0) + 1;
  }

  const used = new Set(sectors.flatMap(sectorVertices));
  const vertices = Object.fromEntries(
    [...used].map((id) => {
      const point = points[Number(id.slice(1))];
      return [id, { x: point.x, y: 0 - point.y }];
    }),
  );
  report.replacedTextures = [...replaced].toSorted();

  // A wall with nothing behind it in the WAD stays solid even where the
  // editor sees a room around the one it belongs to.
  const drawn: GameMap = { vertices, sectors, things, switches };
  const containers = sectorContainers(drawn);
  for (const sector of sectors) {
    if (!containers.get(sector.id)) continue;
    const index = Number(defined(/^s(\d+)/.exec(sector.id))[1]);
    sector.vertices.forEach((id, at) => {
      const next = sector.vertices[(at + 1) % sector.vertices.length];
      const line = lineAt.get(wallKey(id.slice(1), next.slice(1)));
      const other =
        line?.frontSector === index
          ? line.backSector
          : (line?.frontSector ?? null);
      if (other !== null) return;
      const key = wallKey(id, next);
      settings[key] = { ...settings[key], solid: true };
    });
  }

  let complevel: Complevel = "vanilla";
  for (const line of doom.lines) {
    const flags = line.flags & lineReserved ? 0 : line.flags;
    complevel = higherLevel(complevel, lineLevel(line.special, flags));
  }
  for (const sector of doom.sectors) {
    complevel = higherLevel(complevel, sectorLevel(sector.special));
  }
  for (const thing of doom.things) {
    complevel = higherLevel(complevel, thingLevel(thing.type));
  }
  return {
    map: {
      name: doom.title ?? doom.slot,
      ...(complevel === "vanilla" ? {} : { complevel }),
      vertices,
      sectors,
      things,
      switches,
      ...(Object.keys(settings).length > 0 ? { lines: settings } : {}),
    },
    report,
  };
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

function mostCommon(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
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

function keyOf(a: number, b: number) {
  return wallKey(vertexId(a), vertexId(b));
}

function vertexId(index: number) {
  return `v${index}`;
}

function isSwitch(name: string) {
  return /^SW[12]/.test(name);
}
