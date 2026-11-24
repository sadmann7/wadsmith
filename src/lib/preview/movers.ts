import type { GameMap, LineActionKind, Sector } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import {
  fieldValue,
  generalizedFields,
  generalizedKind,
  generalizedTrigger,
} from "@/lib/map/boom";
import { atLeast } from "@/lib/map/complevel";
import { wallOwners, wallPartTexture } from "@/lib/map/geometry";
import { actionForSpecial, lineUsesTag } from "@/lib/map/lines";
import { parseSurface } from "@/lib/map/surfaces";
import { buildLevel } from "@/lib/wad/compile";

/** The height of a wall texture, by its name. */
export type TextureHeight = (name: string) => number;

interface Heights {
  floor?: number;
  ceiling?: number;
}

type Moves = Map<string, Heights>;

interface Mover {
  work: (room: Sector, textureHeight: TextureHeight | null) => Moves;
}

interface LevelLine {
  front: number;
  back: number | null;
  wall: string;
}

interface Movers {
  map: GameMap;
  shut: Map<string, Sector>;
  around: Map<string, Sector[]>;
  candidates: Map<string, Mover[]>;
  boom: boolean;
  levelLines: () => LevelLine[][] | null;
}

interface Shown {
  map: GameMap;
  rooms: Set<string>;
}

interface Plans {
  plans: Map<string, Moves>;
  movedBy: Map<string, string>;
  shown: Map<string, Shown>;
}

// How far a door stops short of the lowest ceiling beside it when open.
const doorClearance = 4;

// The floor vanilla's donut reads when the pool's first line has no back,
// from the DOS memory Woof emulates.
const donutOverrunFloor = 0x199257 / 0x10000;

const vanillaSteps: Partial<Record<LineActionKind, number>> = {
  stairs: 8,
  "stairs-fast": 16,
};
const boomSteps = [4, 8, 16, 24];

const moversCache = new WeakMap<GameMap, Movers>();
const plansCache = new WeakMap<object, WeakMap<GameMap, Plans>>();
const noTextures = {};

// The map as the view draws it: every door shut, and the movers named in
// `opened` as they stand once worked. An open door's ceiling stops just under
// the lowest ceiling beside it, and floors and ceilings rest where Doom's
// movers stop them. A room several actions start in takes the one that leaves
// it the most room between floor and ceiling, the first line in wall order on
// a tie, and a room two opened movers reach stays where the first in the
// map's room order leaves it.
export function withMovers(
  map: GameMap,
  opened: readonly string[],
  textureHeight?: TextureHeight,
): GameMap {
  return shownWith(map, opened, textureHeight).map;
}

// Every room the view shows moved, with the movers named in `opened` worked.
export function movedRooms(
  map: GameMap,
  opened: readonly string[],
  textureHeight?: TextureHeight,
): ReadonlySet<string> {
  return shownWith(map, opened, textureHeight).rooms;
}

// A room that moves when worked: a door, or one a line's action starts a
// floor, ceiling, lift, stairs, donut or crusher in.
export function getIsMover(map: GameMap, id: string) {
  return getIsDoor(map, id) || moversOf(map).candidates.has(id);
}

// The mover a surface belongs to. A wall stands for the mover behind it before
// the room it is in, so a door's face opens the door, and a room moved from
// another, like a step of a stair, stands for the room its mover starts in.
export function moverAt(
  map: GameMap,
  key: string | null,
  textureHeight?: TextureHeight,
) {
  const surface = key ? parseSurface(key) : null;
  if (!surface || surface.kind === "thing") return null;
  const { movedBy } = plansOf(map, textureHeight);
  const of = (id: string) =>
    getIsMover(map, id) ? id : (movedBy.get(id) ?? null);
  const behind =
    surface.kind === "wall"
      ? wallOwners(map)
          .get(surface.wall)
          ?.find((item) => item.id !== surface.sector)
      : undefined;
  return (behind && of(behind.id)) || of(surface.sector);
}

function shownWith(
  map: GameMap,
  opened: readonly string[],
  textureHeight: TextureHeight | undefined,
): Shown {
  const { shut, around } = moversOf(map);
  const { plans, shown } = plansOf(map, textureHeight);
  const wanted = new Set(opened);
  const open = map.sectors.filter(
    (sector) => wanted.has(sector.id) && (sector.door || plans.has(sector.id)),
  );
  const key = open.map((sector) => sector.id).join(",");
  const known = shown.get(key);
  if (known) return known;
  const moved = new Map<string, Heights>();
  for (const sector of open) {
    if (sector.door) {
      // Doom reads the heights beside a door with every other door shut.
      const beside = around.get(sector.id) ?? [];
      const ceiling =
        beside.length > 0
          ? Math.min(...beside.map((item) => item.ceiling)) - doorClearance
          : sector.floor;
      moved.set(sector.id, { ceiling: Math.max(sector.floor, ceiling) });
      continue;
    }
    for (const [id, heights] of plans.get(sector.id) ?? []) {
      if (!moved.has(id)) moved.set(id, heights);
    }
  }
  const result = {
    map: {
      ...map,
      sectors: map.sectors.map((sector) => {
        const base = shut.get(sector.id) ?? sector;
        const heights = moved.get(sector.id);
        return heights ? { ...base, ...heights } : base;
      }),
    },
    rooms: new Set(moved.keys()),
  };
  shown.set(key, result);
  return result;
}

function getIsDoor(map: GameMap, id: string) {
  return Boolean(map.sectors.find((sector) => sector.id === id)?.door);
}

function plansOf(map: GameMap, textureHeight?: TextureHeight): Plans {
  const byTextures = textureHeight ?? noTextures;
  let byMap = plansCache.get(byTextures);
  if (!byMap) {
    byMap = new WeakMap();
    plansCache.set(byTextures, byMap);
  }
  const cached = byMap.get(map);
  if (cached) return cached;
  const { shut, candidates } = moversOf(map);
  const plans = new Map<string, Moves>();
  for (const [id, list] of candidates) {
    const room = shut.get(id);
    if (!room) continue;
    let best: { moves: Moves; gap: number } | null = null;
    for (const mover of list) {
      const moves = mover.work(room, textureHeight ?? null);
      const { floor, ceiling } = { ...room, ...moves.get(id) };
      if (!best || ceiling - floor > best.gap) {
        best = { moves, gap: ceiling - floor };
      }
    }
    if (best) plans.set(id, best.moves);
  }
  const movedBy = new Map<string, string>();
  for (const sector of map.sectors) {
    for (const id of plans.get(sector.id)?.keys() ?? []) {
      if (!movedBy.has(id)) movedBy.set(id, sector.id);
    }
  }
  const result = { plans, movedBy, shown: new Map() };
  byMap.set(map, result);
  return result;
}

function moversOf(map: GameMap): Movers {
  const cached = moversCache.get(map);
  if (cached) return cached;
  const shut = new Map(
    map.sectors.map((sector) => [
      sector.id,
      sector.door ? { ...sector, ceiling: sector.floor } : sector,
    ]),
  );
  const around = new Map<string, Sector[]>();
  for (const owners of wallOwners(map).values()) {
    const [one, other] = owners;
    if (!other || one === other) continue;
    const a = shut.get(one.id) ?? one;
    const b = shut.get(other.id) ?? other;
    around.set(a.id, [...(around.get(a.id) ?? []), b]);
    around.set(b.id, [...(around.get(b.id) ?? []), a]);
  }
  let level: LevelLine[][] | null | undefined;
  const levelLines = () => {
    if (level === undefined) level = linesBySector(map);
    return level;
  };
  const movers: Movers = {
    map,
    shut,
    around,
    candidates: new Map(),
    boom: atLeast(map.complevel ?? "vanilla", "boom"),
    levelLines,
  };
  const tagged = (tag: number) =>
    tag > 0
      ? map.sectors.filter((sector) => sector.tag === tag && !sector.door)
      : [];
  // A pressed Boom line works the room behind it, whatever its tag.
  const behind = (wall: string) => {
    const line = levelLines()
      ?.flat()
      .find((item) => item.wall === wall);
    const room =
      line && line.back !== null && line.back !== line.front
        ? map.sectors[line.back]
        : null;
    return room && !room.door ? [room] : [];
  };
  for (const wall of Object.keys(map.lines ?? {}).toSorted()) {
    const { action, raw } = map.lines?.[wall] ?? {};
    const named =
      action ?? (raw?.special ? actionForSpecial(raw.special, raw.tag) : null);
    let work: Mover["work"] | null = null;
    let starts: Sector[] = [];
    if (named) {
      work = lineUsesTag(named) ? vanillaWork(movers, named.kind) : null;
      starts = tagged(named.tag);
    } else if (raw?.special && generalizedKind(raw.special)) {
      work = boomWork(movers, raw.special);
      starts =
        generalizedTrigger(raw.special).trigger === "door"
          ? behind(wall)
          : tagged(raw.tag);
    }
    if (!work) continue;
    for (const start of starts) {
      const list = movers.candidates.get(start.id) ?? [];
      movers.candidates.set(start.id, [...list, { work }]);
    }
  }
  moversCache.set(map, movers);
  return movers;
}

// Each room's lines in linedef order, as the engine groups them, or null when
// the map doesn't build.
function linesBySector(map: GameMap) {
  try {
    const { lines } = buildLevel(map);
    const bySector: LevelLine[][] = map.sectors.map(() => []);
    for (const { frontSector, backSector, wall } of lines) {
      const line = { front: frontSector, back: backSector, wall };
      bySector[frontSector].push(line);
      if (backSector !== null && backSector !== frontSector) {
        bySector[backSector].push(line);
      }
    }
    return bySector;
  } catch {
    return null;
  }
}

function floorTo(room: Sector, floor: number): Moves {
  return new Map([[room.id, { floor: Math.min(room.ceiling, floor) }]]);
}

function lowerFloorTo(room: Sector, floor: number): Moves {
  return new Map([[room.id, { floor }]]);
}

function ceilingTo(room: Sector, ceiling: number): Moves {
  return new Map([[room.id, { ceiling: Math.max(room.floor, ceiling) }]]);
}

const still: Moves = new Map();

function vanillaWork(
  movers: Movers,
  kind: LineActionKind,
): Mover["work"] | null {
  const step = vanillaSteps[kind];
  if (step) {
    return (room) =>
      stairs(movers, room, { step, up: true, anyTexture: false });
  }
  if (kind === "donut") return (room) => donut(movers, room);
  const heights = vanillaHeights(kind);
  if (!heights) return null;
  return (room, textureHeight) => {
    const beside = movers.around.get(room.id) ?? [];
    return beside.length > 0
      ? heights(room, nearby(room, beside), () =>
          shortestTexture(movers.map, room, "lower", textureHeight),
        )
      : still;
  };
}

interface Nearby {
  lowestFloor: number;
  highestFloor: number;
  lowestCeiling: number;
  highestCeiling: number;
  nextFloorUp: number;
  nextFloorDown: number;
  nextCeilingUp: number;
  nextCeilingDown: number;
}

function nearby(room: Sector, beside: Sector[]): Nearby {
  const floors = beside.map((item) => item.floor);
  const ceilings = beside.map((item) => item.ceiling);
  const above = (values: number[], from: number) =>
    Math.min(...values.filter((value) => value > from), Infinity);
  const below = (values: number[], from: number) =>
    Math.max(...values.filter((value) => value < from), -Infinity);
  const or = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  return {
    lowestFloor: Math.min(room.floor, ...floors),
    highestFloor: Math.max(...floors),
    lowestCeiling: Math.min(...ceilings),
    highestCeiling: Math.max(...ceilings),
    nextFloorUp: or(above(floors, room.floor), room.floor),
    nextFloorDown: or(below(floors, room.floor), room.floor),
    nextCeilingUp: or(above(ceilings, room.ceiling), room.ceiling),
    nextCeilingDown: or(below(ceilings, room.ceiling), room.ceiling),
  };
}

type Worked = (
  room: Sector,
  near: Nearby,
  shortest: () => number | null,
) => Moves;

function vanillaHeights(kind: LineActionKind): Worked | null {
  switch (kind) {
    case "lift":
    case "lift-fast":
    case "platform":
    case "floor-lower":
    case "floor-lower-texture":
      return (room, near) => lowerFloorTo(room, near.lowestFloor);
    case "floor-lower-highest":
      return (room, near) => lowerFloorTo(room, near.highestFloor);
    case "floor-lower-fast":
      return (room, near) =>
        lowerFloorTo(
          room,
          near.highestFloor === room.floor
            ? near.highestFloor
            : near.highestFloor + 8,
        );
    case "floor-raise":
      return (room, near) => floorTo(room, near.lowestCeiling);
    case "floor-crush":
      return (room, near) =>
        lowerFloorTo(room, Math.min(room.ceiling, near.lowestCeiling) - 8);
    case "floor-raise-next":
    case "floor-raise-next-fast":
    case "floor-raise-next-texture":
      return (room, near) => floorTo(room, near.nextFloorUp);
    case "floor-raise-24":
    case "floor-raise-24-texture":
      return (room) => floorTo(room, room.floor + 24);
    case "floor-raise-32-texture":
      return (room) => floorTo(room, room.floor + 32);
    case "floor-raise-512":
      return (room) => floorTo(room, room.floor + 512);
    case "floor-raise-texture":
      return (room, _near, shortest) => {
        const by = shortest();
        return by === null ? still : floorTo(room, room.floor + by);
      };
    case "ceiling-lower":
      return (room) => ceilingTo(room, room.floor);
    case "ceiling-lower-8":
    case "crusher":
    case "crusher-fast":
    case "crusher-silent":
      return (room) => ceilingTo(room, room.floor + 8);
    case "ceiling-raise":
      return (room, near) => ceilingTo(room, near.highestCeiling);
    default:
      return null;
  }
}

function boomWork(movers: Movers, special: number): Mover["work"] | null {
  const kind = generalizedKind(special);
  if (!kind) return null;
  const fields = new Map(
    generalizedFields(special).map((field) => [
      field.id,
      fieldValue(special, field),
    ]),
  );
  const value = (id: string) => fields.get(id) ?? 0;
  const up = value("direction") === 1;
  if (kind.class === "stairs") {
    return (room) =>
      stairs(movers, room, {
        step: boomSteps[value("step")],
        up,
        anyTexture: value("ignore") === 1,
      });
  }
  const heights = boomHeights(kind.class, value("target"), up);
  if (!heights) return null;
  const part = kind.class === "ceiling" ? "upper" : "lower";
  return (room, textureHeight) => {
    const beside = movers.around.get(room.id) ?? [];
    return beside.length > 0
      ? heights(room, nearby(room, beside), () =>
          shortestTexture(movers.map, room, part, textureHeight),
        )
      : still;
  };
}

// Boom stops a rising floor at its ceiling and a lowering ceiling at its
// floor, and a mover sent the wrong way to its target jumps straight there.
function boomHeights(
  kind: string,
  target: number,
  up: boolean,
): Worked | null {
  const sign = up ? 1 : -1;
  const floor = (room: Sector, height: number) =>
    up ? floorTo(room, height) : lowerFloorTo(room, height);
  const ceiling = (room: Sector, height: number) =>
    up
      ? new Map([[room.id, { ceiling: height }]])
      : ceilingTo(room, height);
  if (kind === "floor") {
    const by = (amount: number): Worked => (room) =>
      floor(room, room.floor + sign * amount);
    const targets: Worked[] = [
      (room, near) => floor(room, near.highestFloor),
      (room, near) => floor(room, near.lowestFloor),
      (room, near) =>
        floor(room, up ? near.nextFloorUp : near.nextFloorDown),
      (room, near) => floor(room, near.lowestCeiling),
      (room) => floor(room, room.ceiling),
      (room, _near, shortest) => {
        const amount = shortest();
        return amount === null ? still : by(amount)(room, _near, shortest);
      },
      by(24),
      by(32),
    ];
    return targets[target];
  }
  if (kind === "ceiling") {
    const by = (amount: number): Worked => (room) =>
      ceiling(room, room.ceiling + sign * amount);
    const targets: Worked[] = [
      (room, near) => ceiling(room, near.highestCeiling),
      (room, near) => ceiling(room, near.lowestCeiling),
      (room, near) =>
        ceiling(room, up ? near.nextCeilingUp : near.nextCeilingDown),
      (room, near) => ceiling(room, near.highestFloor),
      (room) => ceiling(room, room.floor),
      (room, _near, shortest) => {
        const amount = shortest();
        return amount === null ? still : by(amount)(room, _near, shortest);
      },
      by(24),
      by(32),
    ];
    return targets[target];
  }
  if (kind === "lift") {
    const targets: Worked[] = [
      (room, near) => lowerFloorTo(room, near.lowestFloor),
      (room, near) => lowerFloorTo(room, near.nextFloorDown),
      (room, near) =>
        lowerFloorTo(room, Math.min(room.floor, near.lowestCeiling)),
      (room, near) => lowerFloorTo(room, near.lowestFloor),
    ];
    return targets[target];
  }
  if (kind === "crusher") return (room) => ceilingTo(room, room.floor + 8);
  return null;
}

// A stair raises the room it starts in by a step, then the room behind each
// next line the last step is in front of, while the floor texture matches.
// Vanilla counts a step for a matching room already in the stair too.
function stairs(
  movers: Movers,
  start: Sector,
  { step, up, anyTexture }: { step: number; up: boolean; anyTexture: boolean },
): Moves {
  const { map, shut, boom } = movers;
  const lines = movers.levelLines();
  const sign = up ? 1 : -1;
  let height = start.floor + sign * step;
  const moves: Moves = new Map([
    [start.id, { floor: up ? Math.min(start.ceiling, height) : height }],
  ]);
  if (!lines) return moves;
  let index = map.sectors.findIndex((sector) => sector.id === start.id);
  for (;;) {
    let next = -1;
    for (const line of lines[index]) {
      if (line.back === null || line.front !== index) continue;
      const room = defined(shut.get(map.sectors[line.back].id));
      if (room.door) continue;
      if (!anyTexture && room.floorTexture !== start.floorTexture) continue;
      if (!boom) height += sign * step;
      if (moves.has(room.id)) continue;
      if (boom) height += sign * step;
      next = line.back;
      moves.set(room.id, {
        floor: up ? Math.min(room.ceiling, height) : height,
      });
      break;
    }
    if (next < 0) return moves;
    index = next;
  }
}

// A donut lowers the room it starts in and raises the pool round it, both to
// the floor of the room behind the pool's first line that doesn't face the
// start. Vanilla doesn't skip a one-sided line there.
function donut(movers: Movers, start: Sector): Moves {
  const { map, shut, boom } = movers;
  const lines = movers.levelLines();
  const index = map.sectors.findIndex((sector) => sector.id === start.id);
  const first = lines?.[index][0];
  if (!lines || !first || first.back === null) return still;
  if (boom && first.front === first.back) return still;
  const poolIndex = first.front === index ? first.back : first.front;
  const pool = defined(shut.get(map.sectors[poolIndex].id));
  for (const line of lines[poolIndex]) {
    if (line.back === index || (boom && line.back === null)) continue;
    const floor =
      line.back === null
        ? donutOverrunFloor
        : defined(shut.get(map.sectors[line.back].id)).floor;
    return new Map([
      [pool.id, { floor }],
      [start.id, { floor }],
    ]);
  }
  return still;
}

function shortestTexture(
  map: GameMap,
  room: Sector,
  part: "upper" | "lower",
  textureHeight: TextureHeight | null,
) {
  if (!textureHeight) return null;
  let least = Infinity;
  for (const [wall, [one, other]] of wallOwners(map)) {
    if (!other || one === other || (one.id !== room.id && other.id !== room.id))
      continue;
    const door = one.door ?? other.door;
    for (const side of [one, other]) {
      const name =
        part === "upper" && door
          ? (map.lines?.[wall]?.sides?.[side.id]?.upper ?? door.texture)
          : wallPartTexture(map, side, wall, part);
      least = Math.min(least, textureHeight(name));
    }
  }
  return Number.isFinite(least) ? least : null;
}
