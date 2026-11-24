import type {
  GameMap,
  LineActionKind,
  LineSettings,
  Point,
  Sector,
  Thing,
} from "./types";

import { thingCatalog } from "./catalog";
import { loopPolygon, sectorAt, wallOwners } from "./geometry";
import {
  actionForSpecial,
  endsLevel,
  getIsTeleport,
  lineUsesTag,
  movesSector,
} from "./lines";

const playerHeight = 56;

interface RoomWall {
  wall: string;
  from: Point;
  to: Point;
  other?: Sector;
}

// What the player can't get to from the player start: the items, keys and
// walls that end the level, and the rooms holding them that it could stand in. Anything
// an action could open counts as open, so only clear cases are found.
export function findUnreachable(map: GameMap) {
  const start = map.things.find((thing) => thing.kind === "player");
  const first = start && sectorAt(map, start);
  if (!first) return null;
  const walls = roomWalls(map);
  const fits = new Map<Sector, boolean>();
  const hasRoom = (sector: Sector) => {
    const known = fits.get(sector);
    if (known !== undefined) return known;
    const found = getHasRoom(map, sector, walls.get(sector) ?? []);
    fits.set(sector, found);
    return found;
  };
  const reached = reachableRooms(map, first, walls, hasRoom);
  const things = map.things.flatMap((thing) => {
    const { category } = thingCatalog[thing.kind];
    if (category !== "item" && category !== "key") return [];
    const room = sectorAt(map, thing);
    if (!room || room.door || reached.has(room)) return [];
    return getIsTouched(thing, room, walls.get(room) ?? [], reached)
      ? []
      : [{ thing, room }];
  });
  const owners = wallOwners(map);
  const exits = Object.entries(map.lines ?? {}).flatMap(([wall, line]) => {
    if (!getEndsLevel(line)) return [];
    const sides = owners.get(wall) ?? [];
    if (sides.some((room) => reached.has(room))) return [];
    const [from, to] = wall.split("|").map((id) => map.vertices[id]);
    const pressable = sides.some((room) =>
      getIsPressable(from, to, room, walls.get(room) ?? [], reached),
    );
    return pressable ? [] : [{ wall, room: sides[0] }];
  });
  // Crates, windows and scenery are often out of reach on purpose, so a room
  // is only named when it holds something the player can't get to.
  const holding = new Set([...things, ...exits].map(({ room }) => room));
  const rooms = map.sectors.filter(
    (sector) =>
      holding.has(sector) &&
      sector.ceiling - sector.floor >= playerHeight &&
      hasRoom(sector),
  );
  return { rooms, things, exits };
}

function roomWalls(map: GameMap) {
  const walls = new Map<Sector, RoomWall[]>();
  for (const [wall, owners] of wallOwners(map)) {
    const [from, to] = wall.split("|").map((id) => map.vertices[id]);
    for (const room of new Set(owners)) {
      const other = owners.find((owner) => owner !== room);
      walls.set(room, [...(walls.get(room) ?? []), { wall, from, to, other }]);
    }
  }
  return walls;
}

// A running player keeps its height for a moment after leaving a ledge and
// falls slowly at first, so it crosses a short gap to a floor it could step
// up to. A room the player box can't fit in is crossed, not entered: the
// player stands on the highest floor under it, as if the rooms beside it met.
const runGap = 128;

function reachableRooms(
  map: GameMap,
  first: Sector,
  walls: Map<Sector, RoomWall[]>,
  hasRoom: (sector: Sector) => boolean,
) {
  const moving = movingRooms(map);
  const exits = new Map<Sector, Set<Sector>>();
  const leads = new Map<Sector, number[]>();
  const link = (from: Sector, to: Sector) =>
    exits.set(from, (exits.get(from) ?? new Set()).add(to));
  for (const [wall, [a, b]] of wallOwners(map)) {
    const line = map.lines?.[wall];
    for (const tag of teleportTags(line)) {
      for (const room of [a, b]) {
        if (room) leads.set(room, [...(leads.get(room) ?? []), tag]);
      }
    }
    if (!a || !b || a === b || line?.blocksAll) continue;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (moving.has(from) || moving.has(to) || getIsWalkable([from, to])) {
        link(from, to);
      }
    }
  }
  for (const [middle, list] of walls) {
    if (moving.has(middle)) continue;
    const open = list.filter(
      (item): item is RoomWall & { other: Sector } =>
        Boolean(item.other) && !map.lines?.[item.wall]?.blocksAll,
    );
    const narrow = !hasRoom(middle);
    for (const from of open) {
      for (const to of open) {
        if (from.other === to.other || exits.get(from.other)?.has(to.other)) {
          continue;
        }
        const crosses = narrow
          ? getIsWalkable([from.other, middle, to.other])
          : middle.floor < from.other.floor &&
            getIsWalkable([from.other, to.other]) &&
            middle.ceiling - Math.max(from.other.floor, to.other.floor) >=
              playerHeight &&
            segmentDistance(from.from, from.to, to.from, to.to) <= runGap;
        if (crosses) link(from.other, to.other);
      }
    }
  }
  const tagged = new Map<number, Sector[]>();
  for (const sector of map.sectors) {
    if (!sector.tag) continue;
    tagged.set(sector.tag, [...(tagged.get(sector.tag) ?? []), sector]);
  }
  const reached = new Set<Sector>();
  const queue = [first];
  for (const room of queue) {
    if (reached.has(room)) continue;
    reached.add(room);
    queue.push(...(exits.get(room) ?? []));
    for (const tag of leads.get(room) ?? []) {
      queue.push(...(tagged.get(tag) ?? []));
    }
  }
  return reached;
}

const maxStep = 24;

// The player steps up from each floor to the next along the way, standing on
// the highest one so far, and needs headroom under every ceiling at once.
function getIsWalkable(rooms: Sector[]) {
  let standing = rooms[0].floor;
  for (const room of rooms.slice(1)) {
    if (room.floor - standing > maxStep) return false;
    standing = Math.max(standing, room.floor);
  }
  const top = Math.max(...rooms.map((room) => room.floor));
  const low = Math.min(...rooms.map((room) => room.ceiling));
  return low - top >= playerHeight;
}

const playerRadius = 16;
const gridSteps = 32;
// Finer than the narrowest strip a player fits in, measured along an axis.
const maxGridStep = 16;

// Whether a player box fits somewhere inside the room, tried on a grid.
function getHasRoom(map: GameMap, sector: Sector, walls: RoomWall[]) {
  const outline = loopPolygon(map, sector.vertices);
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const left = Math.min(...xs) + playerRadius;
  const right = Math.max(...xs) - playerRadius;
  const top = Math.min(...ys) + playerRadius;
  const bottom = Math.max(...ys) - playerRadius;
  if (left > right || top > bottom) return false;
  const step = Math.min(
    maxGridStep,
    Math.max(1, Math.max(right - left, bottom - top) / gridSteps),
  );
  for (let x = left; x <= right; x += step) {
    for (let y = top; y <= bottom; y += step) {
      const spot = { x, y };
      if (
        walls.every(
          ({ from, to }) => boxDistance(from, to, spot) >= playerRadius,
        ) &&
        sectorAt(map, spot) === sector
      ) {
        return true;
      }
    }
  }
  return false;
}

// The engine hands over an item when the player's box touches its box, even
// across a wall, as long as the item is no more than 8 below the player's
// feet and no higher than the player is tall.
const itemRadius = 20;
const pickupBelow = 8;

function getIsTouched(
  thing: Thing,
  room: Sector,
  walls: RoomWall[],
  reached: Set<Sector>,
) {
  return walls.some(({ from, to, other }) => {
    if (!other || !reached.has(other)) return false;
    const rise = room.floor - other.floor;
    return (
      rise <= playerHeight &&
      rise >= -pickupBelow &&
      boxDistance(from, to, thing) < itemRadius
    );
  });
}

// A switch is pressed from up to 64 away, through any opening the player can
// see it through.
const useRange = 64;

function getIsPressable(
  from: Point,
  to: Point,
  room: Sector,
  walls: RoomWall[],
  reached: Set<Sector>,
) {
  return walls.some(
    (opening) =>
      opening.other &&
      reached.has(opening.other) &&
      Math.min(room.ceiling, opening.other.ceiling) >
        Math.max(room.floor, opening.other.floor) &&
      segmentDistance(from, to, opening.from, opening.to) + playerRadius <=
        useRange,
  );
}

function getEndsLevel({ action, raw }: LineSettings) {
  if (action) return endsLevel(action.kind);
  const kind = raw && actionForSpecial(raw.special)?.kind;
  return Boolean(kind && endsLevel(kind));
}

// How far a point is from a wall, measured the way a box meets a line: along
// whichever axis is further.
function boxDistance(a: Point, b: Point, point: Point) {
  const near = nearestOn(a, b, point);
  return Math.max(Math.abs(point.x - near.x), Math.abs(point.y - near.y));
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}

function pointDistance(point: Point, from: Point, to: Point) {
  const near = nearestOn(from, to, point);
  return Math.hypot(point.x - near.x, point.y - near.y);
}

function nearestOn(a: Point, b: Point, point: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
        );
  return { x: a.x + dx * along, y: a.y + dy * along };
}

// A raw special the editor can't name may teleport, so it counts as one.
function teleportTags(line: LineSettings | undefined) {
  const tags: number[] = [];
  const { action, raw } = line ?? {};
  if (action && getIsPlayerTeleport(action.kind) && action.tag > 0) {
    tags.push(action.tag);
  }
  if (raw && raw.special > 0 && raw.tag > 0) {
    const kind = actionForSpecial(raw.special)?.kind;
    if (!kind || getIsPlayerTeleport(kind)) tags.push(raw.tag);
  }
  return tags;
}

function getIsPlayerTeleport(kind: LineActionKind) {
  return getIsTeleport(kind) && kind !== "teleport-monsters";
}

// Stairs build on from the tagged room through rooms with the same floor, and
// a donut moves the ring around the tagged room, so both reach past the tag.
function movingRooms(map: GameMap) {
  const moving = new Set<Sector>();
  const tagged = (tag: number) =>
    map.sectors.filter((sector) => sector.tag === tag);
  const around = new Map<Sector, Sector[]>();
  const owners = wallOwners(map);
  for (const [a, b] of owners.values()) {
    if (!a || !b || a === b) continue;
    around.set(a, [...(around.get(a) ?? []), b]);
    around.set(b, [...(around.get(b) ?? []), a]);
  }
  const moveTag = (tag: number, kind: LineActionKind | undefined) => {
    const rooms = tagged(tag);
    for (const room of rooms) moving.add(room);
    if (kind === "donut") {
      for (const room of rooms) {
        for (const next of around.get(room) ?? []) moving.add(next);
      }
    } else if (!kind || kind === "stairs" || kind === "stairs-fast") {
      const queue = [...rooms];
      for (const room of queue) {
        for (const next of around.get(room) ?? []) {
          if (moving.has(next) || next.floorTexture !== room.floorTexture) {
            continue;
          }
          moving.add(next);
          queue.push(next);
        }
      }
    }
  };
  for (const sector of map.sectors) {
    if (
      sector.door ||
      sector.effect === "door-close-30" ||
      sector.effect === "door-open-300"
    ) {
      moving.add(sector);
    }
  }
  for (const [wall, { action, raw }] of Object.entries(map.lines ?? {})) {
    const sides = owners.get(wall) ?? [];
    if (action && movesSector(action.kind)) {
      if (!lineUsesTag(action)) for (const room of sides) moving.add(room);
      else if (action.tag > 0) moveTag(action.tag, action.kind);
    }
    if (raw && raw.special > 0) {
      const kind = actionForSpecial(raw.special)?.kind;
      if (raw.tag > 0) moveTag(raw.tag, kind);
      for (const room of sides) moving.add(room);
    }
  }
  return moving;
}
