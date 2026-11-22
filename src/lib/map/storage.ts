import type {
  Complevel,
  DoorSettings,
  GameMap,
  KeyColor,
  LineAction,
  LineSettings,
  LineSide,
  LineTrigger,
  MapNote,
  MapSwitch,
  Point,
  RawSpecial,
  Sector,
  SectorEffect,
  Thing,
  ThingKind,
  ThingSkill,
} from "./types";

import {
  doorTextures,
  sectorEffects,
  switchTextures,
  thingKinds,
} from "./catalog";
import { complevels } from "./complevel";
import {
  isLineActionKind,
  keyColors,
  lineSpecial,
  lineTriggers,
} from "./lines";

const fileFormat = "wadsmith-map";
const fileVersion = 1;
const storageKey = "wadsmith:map";
const backupKey = "wadsmith:map:unreadable";

const maxNameLength = 80;

const wordLimit = 32767;

const maxItems = 20000;
export const maxFileBytes = 5 * 1024 * 1024;

export class MapFileError extends Error {}

export function parseMap(value: unknown): GameMap {
  const map = record(value, "The map");
  const entries = Object.entries(record(map.vertices, "The corners"));
  if (entries.length > maxItems) fail("The map has too many corners.");
  const vertices = Object.fromEntries(
    entries.map(([vertex, point]) => [
      id(vertex, "A corner"),
      parsePoint(point, "A corner"),
    ]),
  );
  const sectors = list(map.sectors, "The rooms").map((sector) =>
    parseSector(sector, vertices),
  );
  const rooms = new Set(sectors.map((sector) => sector.id));
  const things = list(map.things, "The things").map(parseThing);
  const switches = list(map.switches, "The switches").map((item) =>
    parseSwitch(item, vertices, rooms),
  );
  const lines =
    map.lines === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(record(map.lines, "The lines")).map(([wall, line]) => [
            wallId(wall, "A line"),
            parseLine(line, rooms),
          ]),
        );
  const notes =
    map.notes === undefined
      ? undefined
      : list(map.notes, "The notes").map(parseNote);
  uniqueIds(notes ?? [], "Note");
  uniqueIds(sectors, "Room");
  uniqueIds(things, "Thing");
  uniqueIds(switches, "Switch");
  if (
    map.complevel !== undefined &&
    !complevels.includes(map.complevel as Complevel)
  ) {
    fail("The map names an unknown compatibility level.");
  }
  return {
    ...(map.complevel === undefined
      ? {}
      : { complevel: map.complevel as Complevel }),
    ...(typeof map.name === "string"
      ? { name: map.name.slice(0, maxNameLength) }
      : {}),
    vertices,
    sectors,
    things,
    switches,
    ...(lines ? { lines } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function serializeMap(map: GameMap) {
  return JSON.stringify(
    { format: fileFormat, version: fileVersion, map },
    null,
    2,
  );
}

export function parseMapFile(text: string): GameMap {
  if (text.length > maxFileBytes) fail("The file is too large.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail("The file isn't valid JSON.");
  }
  const file = record(data, "The file");
  if (file.format !== fileFormat) fail("This isn't a Wadsmith map.");
  if (file.version !== fileVersion) {
    fail("This map was saved by a different version.");
  }
  return parseMap(file.map);
}

export function loadSavedMap() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
    return saved ? parseMapFile(saved) : null;
  } catch {
    // The next edit overwrites the main key, so keep what couldn't be read.
    try {
      if (saved) localStorage.setItem(backupKey, saved);
    } catch {
      return null;
    }
    return null;
  }
}

export function watchSavedMap(listener: (map: GameMap) => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    try {
      listener(parseMapFile(event.newValue));
    } catch {
      return;
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function saveMap(map: GameMap) {
  try {
    localStorage.setItem(storageKey, serializeMap(map));
    return true;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  throw new MapFileError(message);
}

function record(value: unknown, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} is not valid.`);
  }
  return value as Record<string, unknown>;
}

const heightLimit = 32767;

function parseSector(value: unknown, vertices: Record<string, Point>): Sector {
  const sector = record(value, "A room");
  const sectorId = id(sector.id, "A room");
  const label = `Room ${sectorId}`;
  const corners = (value: unknown, least: number) => {
    const ids = list(value, label).map((vertex) => {
      const vertexId = id(vertex, label);
      if (!Object.hasOwn(vertices, vertexId)) {
        fail(`${label} uses a missing corner.`);
      }
      return vertexId;
    });
    if (ids.length < least) fail(`${label} needs at least ${least} corners.`);
    return ids;
  };
  const loop = corners(sector.vertices, 3);
  const holes =
    sector.holes === undefined
      ? undefined
      : list(sector.holes, label).map((hole) => corners(hole, 3));
  const details =
    sector.details === undefined
      ? undefined
      : list(sector.details, label).map((chain) => corners(chain, 2));
  if (typeof sector.name !== "string") fail(`${label} has an invalid name.`);
  const light = integer(sector.light, 255, label);
  if (light < 0) fail(`${label} has invalid light.`);

  const overrides =
    sector.wallOverrides === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(record(sector.wallOverrides, label)).map(
            ([wall, name]) => {
              return [wallId(wall, label), texture(name, null, label)];
            },
          ),
        );

  if (
    sector.effect !== undefined &&
    !Object.hasOwn(sectorEffects, sector.effect as string)
  ) {
    fail(`${label} has an unknown effect.`);
  }

  return {
    id: sectorId,
    name: sector.name.slice(0, maxNameLength),
    vertices: loop,
    ...(holes && holes.length > 0 ? { holes } : {}),
    ...(details && details.length > 0 ? { details } : {}),
    floor: integer(sector.floor, heightLimit, label),
    ceiling: integer(sector.ceiling, heightLimit, label),
    light,
    floorTexture: texture(sector.floorTexture, null, label),
    ceilingTexture: texture(sector.ceilingTexture, null, label),
    wallTexture: texture(sector.wallTexture, null, label),
    ...(overrides ? { wallOverrides: overrides } : {}),
    ...(sector.door === undefined
      ? {}
      : { door: parseDoor(sector.door, label) }),
    ...(sector.effect === undefined
      ? {}
      : { effect: sector.effect as SectorEffect }),
    ...(sector.rawEffect === undefined
      ? {}
      : { rawEffect: integer(sector.rawEffect, wordLimit, label) }),
    ...(sector.tag === undefined ? {} : { tag: tagNumber(sector.tag, label) }),
  };
}

function list(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > maxItems) {
    fail(`${label} is not a valid list.`);
  }
  return value as unknown[];
}

function wallId(value: string, label: string) {
  const corners = value.split("|");
  if (corners.length !== 2) fail(`${label} has an invalid wall.`);
  corners.forEach((corner) => id(corner, label));
  return value;
}

const idPattern = /^[A-Za-z0-9_-]{1,40}$/;

function id(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !idPattern.test(value) ||
    value === "__proto__"
  ) {
    fail(`${label} has an invalid id.`);
  }
  return value;
}

function parseDoor(value: unknown, label: string): DoorSettings {
  const door = record(value, label);
  if (door.opensBy !== "use" && door.opensBy !== "switch") {
    fail(`${label} has an unknown opener.`);
  }
  if (
    typeof door.closes !== "boolean" ||
    (door.fast !== undefined && typeof door.fast !== "boolean")
  ) {
    fail(`${label} is not valid.`);
  }
  return {
    opensBy: door.opensBy,
    closes: door.closes,
    ...(door.fast ? { fast: true } : {}),
    texture: texture(door.texture, doorTextures, label),
  };
}

// A texture is any lump name; whether the game has it is for the map's checks,
// since the game can change after the map is saved.
const lumpName = /^[A-Z0-9_\-\\[\]]{1,8}$/;

function texture(
  value: unknown,
  allowed: readonly string[] | null,
  label: string,
) {
  if (
    typeof value !== "string" ||
    !lumpName.test(value) ||
    (allowed && !allowed.includes(value))
  ) {
    fail(`${label} uses an unknown texture.`);
  }
  return value;
}

function tagNumber(value: unknown, label: string) {
  const tag = integer(value, wordLimit, label);
  if (tag < 0) fail(`${label} has an invalid tag.`);
  return tag;
}

function integer(value: unknown, limit: number, label: string) {
  if (!Number.isInteger(value) || Math.abs(value as number) > limit) {
    fail(`${label} is out of range.`);
  }
  return value as number;
}

const thingSkills: ThingSkill[] = ["easy", "medium", "hard"];

function parseThing(value: unknown): Thing {
  const thing = record(value, "A thing");
  const thingId = id(thing.id, "A thing");
  if (!thingKinds.includes(thing.kind as ThingKind)) {
    fail(`Thing ${thingId} has an unknown kind.`);
  }
  const angle = integer(thing.angle, 359, `Thing ${thingId}`);
  if (angle < 0) fail(`Thing ${thingId} has an invalid angle.`);
  const skills =
    thing.skills === undefined
      ? undefined
      : list(thing.skills, `Thing ${thingId}`).map((skill) => {
          if (!thingSkills.includes(skill as ThingSkill)) {
            fail(`Thing ${thingId} has an unknown difficulty.`);
          }
          return skill as ThingSkill;
        });
  const thingFlags = (
    ["ambush", "multiplayer", "notDeathmatch", "notCoop", "friendly"] as const
  ).flatMap((flag) => {
    if (thing[flag] === undefined) return [];
    if (typeof thing[flag] !== "boolean")
      fail(`Thing ${thingId} is not valid.`);
    return [[flag, thing[flag]]];
  });
  return {
    id: thingId,
    kind: thing.kind as ThingKind,
    angle,
    ...parsePoint(thing, `Thing ${thingId}`),
    ...(skills ? { skills } : {}),
    ...Object.fromEntries(thingFlags),
  };
}

// Wider than the engine's range, so a map validateMap flags can still be reopened and fixed.
const coordinateLimit = 1_000_000;

function parsePoint(value: unknown, label: string): Point {
  const point = record(value, label);
  return {
    x: integer(point.x, coordinateLimit, label),
    y: integer(point.y, coordinateLimit, label),
  };
}

function parseSwitch(
  value: unknown,
  vertices: Record<string, Point>,
  rooms: Set<string>,
): MapSwitch {
  const item = record(value, "A switch");
  const switchId = id(item.id, "A switch");
  const label = `Switch ${switchId}`;
  const sector = id(item.sector, label);
  const from = id(item.from, label);
  const to = id(item.to, label);
  const door = item.door === null ? null : id(item.door, label);
  if (
    !rooms.has(sector) ||
    (door && !rooms.has(door)) ||
    !Object.hasOwn(vertices, from) ||
    !Object.hasOwn(vertices, to)
  ) {
    fail(`${label} points at something missing.`);
  }
  return {
    id: switchId,
    sector,
    from,
    to,
    door,
    texture: texture(item.texture, switchTextures, label),
  };
}

function parseLine(value: unknown, rooms: Set<string>): LineSettings {
  const label = "A line";
  const line = record(value, label);
  const flags = (
    [
      "blocksAll",
      "blocksEnemies",
      "upperFixed",
      "lowerFixed",
      "hidden",
      "secret",
      "soundBlock",
      "mapped",
      "passUse",
      "solid",
      "shut",
      "scrolls",
    ] as const
  ).flatMap((flag) => {
    if (line[flag] === undefined) return [];
    if (typeof line[flag] !== "boolean") fail(`${label} is not valid.`);
    return [[flag, line[flag]]];
  });
  return {
    ...Object.fromEntries(flags),
    ...(line.action === undefined
      ? {}
      : { action: parseLineAction(line.action, label) }),
    ...(line.raw === undefined
      ? {}
      : { raw: parseRawSpecial(line.raw, label) }),
    ...(line.sides === undefined
      ? {}
      : {
          sides: Object.fromEntries(
            Object.entries(record(line.sides, label)).map(([sector, side]) => {
              if (!rooms.has(id(sector, label))) {
                fail(`${label} points at something missing.`);
              }
              return [sector, parseLineSide(side, label)];
            }),
          ),
        }),
    ...(line.front === undefined
      ? {}
      : {
          front: (() => {
            const front = id(line.front, label);
            if (!rooms.has(front)) {
              fail(`${label} points at something missing.`);
            }
            return front;
          })(),
        }),
  };
}

function parseLineAction(value: unknown, label: string): LineAction {
  const action = record(value, label);
  if (
    !isLineActionKind(action.kind) ||
    !lineTriggers.includes(action.trigger as LineTrigger) ||
    typeof action.repeat !== "boolean" ||
    (action.key !== undefined && !keyColors.includes(action.key as KeyColor))
  ) {
    fail(`${label} has an unknown action.`);
  }
  const parsed: LineAction = {
    kind: action.kind,
    trigger: action.trigger as LineTrigger,
    repeat: action.repeat,
    ...(action.key === undefined ? {} : { key: action.key as KeyColor }),
    tag: tagNumber(action.tag, label),
  };
  if (lineSpecial(parsed) === null) fail(`${label} has an unknown action.`);
  return parsed;
}

function parseRawSpecial(value: unknown, label: string): RawSpecial {
  const raw = record(value, label);
  const special = integer(raw.special, wordLimit, label);
  if (special <= 0) fail(`${label} has an invalid special.`);
  return { special, tag: tagNumber(raw.tag, label) };
}

function parseLineSide(value: unknown, label: string): LineSide {
  const side = record(value, label);
  return {
    ...(side.offsetX === undefined
      ? {}
      : { offsetX: integer(side.offsetX, wordLimit, label) }),
    ...(side.offsetY === undefined
      ? {}
      : { offsetY: integer(side.offsetY, wordLimit, label) }),
    ...(side.upper === undefined
      ? {}
      : { upper: texture(side.upper, null, label) }),
    ...(side.lower === undefined
      ? {}
      : { lower: texture(side.lower, null, label) }),
    ...(side.middle === undefined
      ? {}
      : { middle: texture(side.middle, null, label) }),
  };
}

const maxNoteLength = 280;

function parseNote(value: unknown): MapNote {
  const note = record(value, "A note");
  const noteId = id(note.id, "A note");
  if (typeof note.text !== "string") fail(`Note ${noteId} is not valid.`);
  return {
    id: noteId,
    ...parsePoint(note, `Note ${noteId}`),
    text: note.text.slice(0, maxNoteLength),
  };
}

function uniqueIds(items: { id: string }[], label: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    fail(`${label} ids must be unique.`);
  }
}
