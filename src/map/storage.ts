import {
  ceilingTextures,
  doorTextures,
  floorTextures,
  switchTextures,
  thingKinds,
  wallTextures,
} from "./catalog";
import type {
  DoorSettings,
  GameMap,
  MapSwitch,
  Point,
  Sector,
  Thing,
  ThingKind,
} from "./types";

const fileFormat = "wadsmith-map";
const fileVersion = 1;
const storageKey = "wadsmith:map";
const backupKey = "wadsmith:map:unreadable";
// Wider than the engine's range, so a map validateMap flags can still be reopened and fixed.
const coordinateLimit = 1_000_000;
const maxNameLength = 80;
const heightLimit = 32767;
const maxItems = 20000;
const maxFileBytes = 5 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9_-]{1,40}$/;

class MapFileError extends Error {}

function fail(message: string): never {
  throw new MapFileError(message);
}

function record(value: unknown, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} is not valid.`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > maxItems) {
    fail(`${label} is not a valid list.`);
  }
  return value as unknown[];
}

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

function integer(value: unknown, limit: number, label: string) {
  if (!Number.isInteger(value) || Math.abs(value as number) > limit) {
    fail(`${label} is out of range.`);
  }
  return value as number;
}

// The engine stops with a fatal error on a texture name it doesn't know.
function texture(value: unknown, allowed: readonly string[], label: string) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`${label} uses an unknown texture.`);
  }
  return value;
}

function parsePoint(value: unknown, label: string): Point {
  const point = record(value, label);
  return {
    x: integer(point.x, coordinateLimit, label),
    y: integer(point.y, coordinateLimit, label),
  };
}

function parseDoor(value: unknown, label: string): DoorSettings {
  const door = record(value, label);
  if (door.opensBy !== "use" && door.opensBy !== "switch") {
    fail(`${label} has an unknown opener.`);
  }
  if (typeof door.closes !== "boolean") fail(`${label} is not valid.`);
  return {
    opensBy: door.opensBy,
    closes: door.closes,
    texture: texture(door.texture, doorTextures, label),
  };
}

function parseSector(value: unknown, vertices: Record<string, Point>): Sector {
  const sector = record(value, "A room");
  const sectorId = id(sector.id, "A room");
  const label = `Room ${sectorId}`;
  const loop = list(sector.vertices, label).map((vertex) => {
    const vertexId = id(vertex, label);
    if (!Object.hasOwn(vertices, vertexId)) {
      fail(`${label} uses a missing corner.`);
    }
    return vertexId;
  });
  if (loop.length < 3) fail(`${label} needs at least 3 corners.`);
  if (typeof sector.name !== "string") fail(`${label} has an invalid name.`);
  const light = integer(sector.light, 255, label);
  if (light < 0) fail(`${label} has invalid light.`);

  const overrides =
    sector.wallOverrides === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(record(sector.wallOverrides, label)).map(
            ([wall, name]) => {
              const corners = wall.split("|");
              if (corners.length !== 2) fail(`${label} has an invalid wall.`);
              corners.forEach((corner) => id(corner, label));
              return [wall, texture(name, wallTextures, label)];
            },
          ),
        );

  return {
    id: sectorId,
    name: sector.name.slice(0, maxNameLength),
    vertices: loop,
    floor: integer(sector.floor, heightLimit, label),
    ceiling: integer(sector.ceiling, heightLimit, label),
    light,
    floorTexture: texture(sector.floorTexture, floorTextures, label),
    ceilingTexture: texture(sector.ceilingTexture, ceilingTextures, label),
    wallTexture: texture(sector.wallTexture, wallTextures, label),
    ...(overrides ? { wallOverrides: overrides } : {}),
    ...(sector.door === undefined
      ? {}
      : { door: parseDoor(sector.door, label) }),
  };
}

function parseThing(value: unknown): Thing {
  const thing = record(value, "A thing");
  const thingId = id(thing.id, "A thing");
  if (!thingKinds.includes(thing.kind as ThingKind)) {
    fail(`Thing ${thingId} has an unknown kind.`);
  }
  const angle = integer(thing.angle, 359, `Thing ${thingId}`);
  if (angle < 0) fail(`Thing ${thingId} has an invalid angle.`);
  return {
    id: thingId,
    kind: thing.kind as ThingKind,
    angle,
    ...parsePoint(thing, `Thing ${thingId}`),
  };
}

function parseSwitch(
  value: unknown,
  vertices: Record<string, Point>,
  sectors: Sector[],
): MapSwitch {
  const item = record(value, "A switch");
  const switchId = id(item.id, "A switch");
  const label = `Switch ${switchId}`;
  const sector = id(item.sector, label);
  const from = id(item.from, label);
  const to = id(item.to, label);
  const door = item.door === null ? null : id(item.door, label);
  const known = (room: string) => sectors.some((entry) => entry.id === room);
  if (
    !known(sector) ||
    (door && !known(door)) ||
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

function uniqueIds(items: { id: string }[], label: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    fail(`${label} ids must be unique.`);
  }
}

function parseMap(value: unknown): GameMap {
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
  const things = list(map.things, "The things").map(parseThing);
  const switches = list(map.switches, "The switches").map((item) =>
    parseSwitch(item, vertices, sectors),
  );
  uniqueIds(sectors, "Room");
  uniqueIds(things, "Thing");
  uniqueIds(switches, "Switch");
  return {
    ...(typeof map.name === "string"
      ? { name: map.name.slice(0, maxNameLength) }
      : {}),
    vertices,
    sectors,
    things,
    switches,
  };
}

function serializeMap(map: GameMap) {
  return JSON.stringify(
    { format: fileFormat, version: fileVersion, map },
    null,
    2,
  );
}

function parseMapFile(text: string): GameMap {
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

function loadSavedMap() {
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

function watchSavedMap(listener: (map: GameMap) => void) {
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

function saveMap(map: GameMap) {
  try {
    localStorage.setItem(storageKey, serializeMap(map));
    return true;
  } catch {
    return false;
  }
}

export {
  loadSavedMap,
  MapFileError,
  maxFileBytes,
  parseMapFile,
  saveMap,
  serializeMap,
  watchSavedMap,
};
