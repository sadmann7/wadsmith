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

/** What the opened view reads from the game's wall textures and flats. */
export interface GameTextures {
  /** The height of a wall texture by its name, or null when the game has no such texture. */
  height: (name: string) => number | null;
  /** The texture the engine numbers 0, or null without an IWAD. */
  first: string | null;
  /** The flats as the engine numbers them, null for a marker. */
  flats: readonly (string | null)[];
}

interface Heights {
  floor?: number;
  ceiling?: number;
  floorTexture?: string;
  ceilingTexture?: string;
}

interface Move extends Heights {
  rises?: boolean;
  drops?: boolean;
}

type Moves = Map<string, Move>;

interface Mover {
  work: (room: Sector, textures: GameTextures | null) => Moves;
}

interface LevelLine {
  front: number;
  back: number | null;
  wall: string;
}

interface Level {
  bySector: LevelLine[][];
  fronts: Map<string, number>;
}

interface Shown {
  map: GameMap;
  rooms: Set<string>;
}

interface Shut {
  shut: Map<string, Sector>;
  around: Map<string, Sector[]>;
  shown: Shown;
}

interface Movers extends Shut {
  map: GameMap;
  candidates: Map<string, Mover[]>;
  boom: boolean;
  vanilla: boolean;
  vanillaStairs: boolean;
  level: () => Level | null;
}

interface Plans {
  plans: Map<string, Moves | null>;
  movedBy: Map<string, string> | null;
  shown: Map<string, Shown>;
}

// The map as the view draws it: every door shut, and the movers named in
// `opened` where Doom stops them. A room several actions start in takes the
// one that leaves it the most open, the first wall on a tie, and a floor or
// ceiling two opened movers reach stays where the first in room order puts it.
export function withMovers(
  map: GameMap,
  opened: readonly string[],
  textures?: GameTextures,
): GameMap {
  return shownWith(map, opened, textures).map;
}

// Every room the view shows moved, with the movers named in `opened` worked.
export function movedRooms(
  map: GameMap,
  opened: readonly string[],
  textures?: GameTextures,
): ReadonlySet<string> {
  return shownWith(map, opened, textures).rooms;
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
  textures?: GameTextures,
) {
  const surface = key ? parseSurface(key) : null;
  if (!surface || surface.kind === "thing") return null;
  const of = (id: string) =>
    getIsMover(map, id) ? id : (movedByOf(map, textures).get(id) ?? null);
  const behind =
    surface.kind === "wall"
      ? wallOwners(map)
          .get(surface.wall)
          ?.find((item) => item.id !== surface.sector)
      : undefined;
  return (behind && of(behind.id)) || of(surface.sector);
}

// How far a door stops short of the lowest ceiling beside it when open.
const doorClearance = 4;

function shownWith(
  map: GameMap,
  opened: readonly string[],
  textures: GameTextures | undefined,
): Shown {
  if (opened.length === 0) return shutOf(map).shown;
  const { shut, around, candidates, boom } = moversOf(map);
  const { shown } = plansOf(map, textures);
  const wanted = new Set(opened);
  const open = map.sectors.filter(
    (sector) =>
      wanted.has(sector.id) && (sector.door || candidates.has(sector.id)),
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
      moved.set(sector.id, {
        ceiling: Math.max(sector.floor, ceiling),
        ...moved.get(sector.id),
      });
      continue;
    }
    for (const [id, move] of planOf(map, sector.id, textures) ?? []) {
      const earlier = moved.get(id) ?? {};
      const room = { ...defined(shut.get(id)), ...earlier };
      const later = { ...earlier };
      const { floor, ceiling } = settle(room, move, boom);
      if (earlier.floor === undefined && floor !== undefined) {
        later.floor = floor;
        if (move.floorTexture) later.floorTexture = move.floorTexture;
      }
      if (earlier.ceiling === undefined && ceiling !== undefined) {
        later.ceiling = ceiling;
        if (move.ceilingTexture) later.ceilingTexture = move.ceilingTexture;
      }
      moved.set(id, later);
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

// From Boom on, a plane stops at the other only when moving towards it.
function settle(room: Sector, move: Move, boom: boolean) {
  const { floor, ceiling, rises, drops } = move;
  return {
    floor:
      boom && rises && floor !== undefined
        ? Math.min(floor, room.ceiling)
        : floor,
    ceiling:
      boom && drops && ceiling !== undefined
        ? Math.max(ceiling, room.floor)
        : ceiling,
  };
}

function getIsDoor(map: GameMap, id: string) {
  return Boolean(map.sectors.find((sector) => sector.id === id)?.door);
}

const plansCache = new WeakMap<object, WeakMap<GameMap, Plans>>();

const noTextures = {};

function plansOf(map: GameMap, textures?: GameTextures): Plans {
  const byTextures = textures ?? noTextures;
  let byMap = plansCache.get(byTextures);
  if (!byMap) {
    byMap = new WeakMap();
    plansCache.set(byTextures, byMap);
  }
  let plans = byMap.get(map);
  if (!plans) {
    plans = { plans: new Map(), movedBy: null, shown: new Map() };
    byMap.set(map, plans);
  }
  return plans;
}

function planOf(map: GameMap, id: string, textures?: GameTextures) {
  const { plans } = plansOf(map, textures);
  if (plans.has(id)) return plans.get(id) ?? null;
  const { shut, candidates, boom } = moversOf(map);
  const room = shut.get(id);
  let best: { moves: Moves; gap: number } | null = null;
  for (const mover of room ? (candidates.get(id) ?? []) : []) {
    const start = defined(room);
    const moves = mover.work(start, textures ?? null);
    const move = moves.get(id);
    const settled: Heights = move ? settle(start, move, boom) : {};
    const floor = settled.floor ?? start.floor;
    const ceiling = settled.ceiling ?? start.ceiling;
    if (!best || ceiling - floor > best.gap) {
      best = { moves, gap: ceiling - floor };
    }
  }
  const plan = best?.moves ?? null;
  plans.set(id, plan);
  return plan;
}

function movedByOf(map: GameMap, textures?: GameTextures) {
  const plans = plansOf(map, textures);
  if (plans.movedBy) return plans.movedBy;
  const movedBy = new Map<string, string>();
  for (const sector of map.sectors) {
    for (const id of planOf(map, sector.id, textures)?.keys() ?? []) {
      if (!movedBy.has(id)) movedBy.set(id, sector.id);
    }
  }
  plans.movedBy = movedBy;
  return movedBy;
}

const shutCache = new WeakMap<GameMap, Shut>();

function shutOf(map: GameMap): Shut {
  const cached = shutCache.get(map);
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
  const result = {
    shut,
    around,
    shown: {
      map: {
        ...map,
        sectors: map.sectors.map((sector) => shut.get(sector.id) ?? sector),
      },
      rooms: new Set<string>(),
    },
  };
  shutCache.set(map, result);
  return result;
}

const moversCache = new WeakMap<GameMap, Movers>();

function moversOf(map: GameMap): Movers {
  const cached = moversCache.get(map);
  if (cached) return cached;
  let built: Level | null | undefined;
  const level = () => {
    if (built === undefined) built = levelOf(map);
    return built;
  };
  const complevel = map.complevel ?? "vanilla";
  const movers: Movers = {
    ...shutOf(map),
    map,
    candidates: new Map(),
    boom: atLeast(complevel, "boom"),
    vanilla: complevel === "vanilla",
    vanillaStairs: complevel === "vanilla" || complevel === "mbf",
    level,
  };
  const tagged = (tag: number) =>
    tag > 0
      ? map.sectors.filter((sector) => sector.tag === tag && !sector.door)
      : [];
  // A pressed Boom line works the room behind it, whatever its tag. The
  // compiler puts the room listed first in front, unless that room is a door
  // or the line chose the other.
  const behind = (wall: string) => {
    const [first, second] = wallOwners(map).get(wall) ?? [];
    if (!first || !second || first === second) return [];
    const flipped =
      first.door || (!second.door && map.lines?.[wall]?.front === second.id);
    const room = flipped ? first : second;
    return room.door ? [] : [room];
  };
  for (const wall of Object.keys(map.lines ?? {}).toSorted()) {
    const { action, raw } = map.lines?.[wall] ?? {};
    const named =
      action ?? (raw?.special ? actionForSpecial(raw.special, raw.tag) : null);
    let work: Mover["work"] | null = null;
    let starts: Sector[] = [];
    if (named) {
      starts = tagged(named.tag);
      work = lineUsesTag(named)
        ? vanillaWork(movers, named.kind, wall, starts)
        : null;
    } else if (movers.boom && raw?.special && generalizedKind(raw.special)) {
      starts =
        generalizedTrigger(raw.special).trigger === "door"
          ? behind(wall)
          : tagged(raw.tag);
      work = boomWork(movers, raw.special, wall, starts);
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

// Each room's lines in linedef order, as the engine groups them, and the
// room in front of each wall, or null when the map doesn't build.
function levelOf(map: GameMap): Level | null {
  try {
    const { lines } = buildLevel(map);
    const bySector: LevelLine[][] = map.sectors.map(() => []);
    const fronts = new Map<string, number>();
    for (const { frontSector, backSector, wall } of lines) {
      const line = { front: frontSector, back: backSector, wall };
      fronts.set(wall, frontSector);
      bySector[frontSector].push(line);
      if (backSector !== null && backSector !== frontSector) {
        bySector[backSector].push(line);
      }
    }
    return { bySector, fronts };
  } catch {
    return null;
  }
}

const still: Moves = new Map();

const vanillaSteps: Partial<Record<LineActionKind, number>> = {
  stairs: 8,
  "stairs-fast": 16,
};

// The raises that take the floor texture of the room in front of their line.
const takesFrontTexture = new Set<LineActionKind>([
  "floor-raise-next-texture",
  "floor-raise-24-texture",
  "floor-raise-32-texture",
]);

function vanillaWork(
  movers: Movers,
  kind: LineActionKind,
  wall: string,
  starts: Sector[],
): Mover["work"] | null {
  const step = vanillaSteps[kind];
  if (step) {
    return stairsWork(movers, starts, {
      step,
      up: true,
      anyTexture: false,
      vanillaCount: movers.vanillaStairs,
      search: movers.vanilla,
    });
  }
  if (kind === "donut") return (room, textures) => donut(movers, room, textures);
  const heights = vanillaHeights(kind);
  if (!heights) return null;
  return (room, textures) => {
    const beside = movers.around.get(room.id) ?? [];
    if (beside.length === 0) return still;
    const near = nearby(room, beside);
    const moves = heights(room, near, () =>
      shortestTexture(movers, room, "lower", textures),
    );
    if (kind === "floor-lower-texture") {
      const model = modelOf(movers, room, "floor", near.lowestFloor);
      return withTexture(moves, room, "floor", model);
    }
    return takesFrontTexture.has(kind)
      ? withTexture(moves, room, "floor", frontOf(movers, wall))
      : moves;
  };
}

function frontOf(movers: Movers, wall: string) {
  const index = movers.level()?.fronts.get(wall);
  return index === undefined
    ? null
    : defined(movers.shut.get(movers.map.sectors[index].id));
}

// The room across the first two-sided line of a room whose floor or ceiling
// stands at a height. Vanilla cuts the search short at the line count of the
// last room it looked across, when that is fewer.
function modelOf(
  movers: Movers,
  room: Sector,
  plane: "floor" | "ceiling",
  height: number,
) {
  const { map, shut } = movers;
  const bySector = movers.level()?.bySector;
  if (!bySector) return null;
  const index = map.sectors.findIndex((sector) => sector.id === room.id);
  const own = bySector[index];
  let bound = own.length;
  for (let at = 0; at < bound; at += 1) {
    const { front, back } = own[at];
    if (back === null) continue;
    const across = front === index ? back : front;
    const model = defined(shut.get(map.sectors[across].id));
    if (model[plane] === height) return model;
    if (movers.vanilla) bound = Math.min(own.length, bySector[across].length);
  }
  return null;
}

function withTexture(
  moves: Moves,
  room: Sector,
  plane: "floor" | "ceiling",
  model: Sector | null,
): Moves {
  const move = moves.get(room.id);
  if (!model || !move) return moves;
  const texture =
    plane === "floor"
      ? { floorTexture: model.floorTexture }
      : { ceilingTexture: model.ceilingTexture };
  return new Map([...moves, [room.id, { ...move, ...texture }]]);
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
  return {
    lowestFloor: Math.min(room.floor, ...floors),
    highestFloor: Math.max(...floors),
    lowestCeiling: Math.min(...ceilings),
    highestCeiling: Math.max(...ceilings),
    nextFloorUp: orElse(above(floors, room.floor), room.floor),
    nextFloorDown: orElse(below(floors, room.floor), room.floor),
    nextCeilingUp: orElse(above(ceilings, room.ceiling), room.ceiling),
    nextCeilingDown: orElse(below(ceilings, room.ceiling), room.ceiling),
  };
}

function above(values: number[], from: number) {
  return Math.min(...values.filter((value) => value > from), Infinity);
}

function below(values: number[], from: number) {
  return Math.max(...values.filter((value) => value < from), -Infinity);
}

function orElse(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
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
      return (room, near) => lowerFloor(room, near.lowestFloor);
    case "floor-lower-highest":
      return (room, near) => lowerFloor(room, near.highestFloor);
    case "floor-lower-fast":
      return (room, near) =>
        lowerFloor(
          room,
          near.highestFloor === room.floor
            ? near.highestFloor
            : near.highestFloor + 8,
        );
    case "floor-raise":
      return (room, near) =>
        raiseFloor(room, Math.min(room.ceiling, near.lowestCeiling));
    case "floor-crush":
      return (room, near) =>
        raiseFloor(room, Math.min(room.ceiling, near.lowestCeiling) - 8);
    case "floor-raise-next":
    case "floor-raise-next-fast":
    case "floor-raise-next-texture":
      return (room, near) => raiseFloor(room, near.nextFloorUp);
    case "floor-raise-24":
    case "floor-raise-24-texture":
      return (room) => raiseFloor(room, room.floor + 24);
    case "floor-raise-32-texture":
      return (room) => raiseFloor(room, room.floor + 32);
    case "floor-raise-512":
      return (room) => raiseFloor(room, room.floor + 512);
    case "floor-raise-texture":
      return (room, _near, shortest) => {
        const by = shortest();
        return by === null ? still : raiseFloor(room, room.floor + by);
      };
    case "ceiling-lower":
      return (room) => lowerCeiling(room, room.floor);
    case "ceiling-lower-8":
    case "crusher":
    case "crusher-fast":
    case "crusher-silent":
      return (room) => lowerCeiling(room, room.floor + 8);
    case "ceiling-raise":
      return (room, near) => raiseCeiling(room, near.highestCeiling);
    default:
      return null;
  }
}

const boomSteps = [4, 8, 16, 24];

function boomWork(
  movers: Movers,
  special: number,
  wall: string,
  starts: Sector[],
): Mover["work"] | null {
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
    return stairsWork(movers, starts, {
      step: boomSteps[value("step")],
      up,
      anyTexture: value("ignore") === 1,
      vanillaCount: false,
      search: false,
    });
  }
  const heights = boomHeights(movers, kind.class, value, wall);
  if (!heights) return null;
  const part = kind.class === "ceiling" ? "upper" : "lower";
  return (room, textures) => {
    const beside = movers.around.get(room.id) ?? [];
    return beside.length > 0
      ? heights(room, nearby(room, beside), () =>
          shortestTexture(movers, room, part, textures),
        )
      : still;
  };
}

type Target = (
  room: Sector,
  near: Nearby,
  shortest: () => number | null,
) => number | null;

// A mover sent the wrong way to its target jumps straight there. A texture
// change copies the room in front of the line, or the room across the first
// line at the target height, measured on the plane the target is.
function boomHeights(
  movers: Movers,
  kind: string,
  value: (id: string) => number,
  wall: string,
): Worked | null {
  const up = value("direction") === 1;
  const target = value("target");
  const sign = up ? 1 : -1;
  if (kind === "floor" || kind === "ceiling") {
    const plane = kind;
    const other = plane === "floor" ? "ceiling" : "floor";
    const by =
      (amount: number): Target =>
      (room) =>
        room[plane] + sign * amount;
    const targets: Target[] =
      plane === "floor"
        ? [
            (_room, near) => near.highestFloor,
            (_room, near) => near.lowestFloor,
            (_room, near) => (up ? near.nextFloorUp : near.nextFloorDown),
            (_room, near) => near.lowestCeiling,
            (room) => room.ceiling,
            (room, _near, shortest) => {
              const amount = shortest();
              return amount === null ? null : room.floor + sign * amount;
            },
            by(24),
            by(32),
          ]
        : [
            (_room, near) => near.highestCeiling,
            (_room, near) => near.lowestCeiling,
            (_room, near) => (up ? near.nextCeilingUp : near.nextCeilingDown),
            (_room, near) => near.highestFloor,
            (room) => room.floor,
            (room, _near, shortest) => {
              const amount = shortest();
              return amount === null ? null : room.ceiling + sign * amount;
            },
            by(24),
            by(32),
          ];
    const to = targets[target];
    if (!to) return null;
    const measured = target === 3 || target === 4 ? other : plane;
    return (room, near, shortest) => {
      const height = to(room, near, shortest);
      if (height === null) return still;
      const moves =
        plane === "floor"
          ? up
            ? raiseFloor(room, height)
            : lowerFloor(room, height)
          : up
            ? raiseCeiling(room, height)
            : lowerCeiling(room, height);
      if (value("change") === 0) return moves;
      const model =
        value("model") === 0
          ? frontOf(movers, wall)
          : modelOf(movers, room, measured, height);
      return withTexture(moves, room, plane, model);
    };
  }
  if (kind === "lift") {
    const targets: Worked[] = [
      (room, near) => lowerFloor(room, near.lowestFloor),
      (room, near) => lowerFloor(room, near.nextFloorDown),
      (room, near) =>
        lowerFloor(room, Math.min(room.floor, near.lowestCeiling)),
      (room, near) => lowerFloor(room, near.lowestFloor),
    ];
    return targets[target] ?? null;
  }
  if (kind === "crusher") {
    return (room) => lowerCeiling(room, room.floor + 8);
  }
  return null;
}

function lowerFloor(room: Sector, floor: number): Moves {
  return new Map([[room.id, { floor }]]);
}

function raiseFloor(room: Sector, floor: number): Moves {
  return new Map([[room.id, { floor, rises: true }]]);
}

function raiseCeiling(room: Sector, ceiling: number): Moves {
  return new Map([[room.id, { ceiling }]]);
}

function lowerCeiling(room: Sector, ceiling: number): Moves {
  return new Map([[room.id, { ceiling, drops: true }]]);
}

interface StairOptions {
  step: number;
  up: boolean;
  anyTexture: boolean;
  vanillaCount: boolean;
  search: boolean;
}

// A line builds a stair from each room it tags, lowest first, skipping one a
// stair already moves. Vanilla searches the tag again after each stair for
// the first room past the stair's last step.
function stairsWork(
  movers: Movers,
  starts: Sector[],
  options: StairOptions,
): Mover["work"] {
  let built: Map<string, Moves> | null = null;
  return (room) => {
    built ??= lineStairs(movers, starts, options);
    return built.get(room.id) ?? still;
  };
}

function lineStairs(movers: Movers, starts: Sector[], options: StairOptions) {
  const { map, shut } = movers;
  const indices = starts
    .map((start) => map.sectors.findIndex((sector) => sector.id === start.id))
    .toSorted((a, b) => a - b);
  const moving = new Set<string>();
  const built = new Map<string, Moves>();
  let at = -1;
  let after = -1;
  for (;;) {
    do {
      const from = at;
      at = indices.find((index) => index > from) ?? -1;
    } while (at >= 0 && at <= after);
    if (at < 0) return built;
    const start = defined(shut.get(map.sectors[at].id));
    if (moving.has(start.id)) continue;
    const { moves, last } = stairs(movers, start, options, moving);
    built.set(start.id, moves);
    if (options.search) {
      at = -1;
      after = last;
    }
  }
}

// A stair raises the room it starts in by a step, then the room behind each
// next line the last step is in front of, while the floor texture matches
// and the room isn't moving yet. Vanilla counts a step for a matching room
// that is moving too.
function stairs(
  movers: Movers,
  start: Sector,
  { step, up, anyTexture, vanillaCount }: StairOptions,
  moving: Set<string>,
) {
  const { map, shut } = movers;
  const bySector = movers.level()?.bySector;
  const sign = up ? 1 : -1;
  let height = start.floor + sign * step;
  let index = map.sectors.findIndex((sector) => sector.id === start.id);
  const moves: Moves = new Map([[start.id, { floor: height, rises: up }]]);
  moving.add(start.id);
  if (!bySector) return { moves, last: index };
  for (;;) {
    let next = -1;
    for (const line of bySector[index]) {
      if (line.back === null || line.front !== index) continue;
      const room = defined(shut.get(map.sectors[line.back].id));
      if (!anyTexture && room.floorTexture !== start.floorTexture) continue;
      if (vanillaCount) height += sign * step;
      if (moving.has(room.id)) continue;
      if (!vanillaCount) height += sign * step;
      next = line.back;
      moves.set(room.id, { floor: height, rises: up });
      moving.add(room.id);
      break;
    }
    if (next < 0) return { moves, last: index };
    index = next;
  }
}

// The floor and flat number vanilla's donut reads when the pool's first line
// has no back, from the DOS memory Woof emulates.
const donutOverrunFloor = 0x199257 / 0x10000;
const donutOverrunFlat = 0x16;

// A donut lowers the room it starts in and raises the pool round it, both to
// the floor of the room behind the pool's first line that doesn't face the
// start, and the pool takes that room's floor texture. Vanilla doesn't skip a
// one-sided line there.
function donut(
  movers: Movers,
  start: Sector,
  textures: GameTextures | null,
): Moves {
  const { map, shut, boom } = movers;
  const bySector = movers.level()?.bySector;
  const index = map.sectors.findIndex((sector) => sector.id === start.id);
  const first = bySector?.[index][0];
  if (!bySector || !first || first.back === null) return still;
  if (boom && first.front === first.back) return still;
  const poolIndex = first.front === index ? first.back : first.front;
  const pool = defined(shut.get(map.sectors[poolIndex].id));
  for (const line of bySector[poolIndex]) {
    if (line.back === index || (boom && line.back === null)) continue;
    const model =
      line.back === null ? null : defined(shut.get(map.sectors[line.back].id));
    const floor = model?.floor ?? donutOverrunFloor;
    const floorTexture = model ? model.floorTexture : overrunFlat(textures);
    return new Map([
      [pool.id, { floor, rises: true, ...(floorTexture && { floorTexture }) }],
      [start.id, { floor }],
    ]);
  }
  return still;
}

function overrunFlat(textures: GameTextures | null) {
  const flats = textures?.flats ?? [];
  return flats[Math.min(flats.length - 1, donutOverrunFlat)] ?? null;
}

// A line drawn inside a room has no lower or upper texture, which vanilla
// reads as the first texture, like a name the game doesn't have, and Boom
// skips.
function shortestTexture(
  movers: Movers,
  room: Sector,
  part: "upper" | "lower",
  textures: GameTextures | null,
) {
  if (!textures) return null;
  const { map, vanilla } = movers;
  const { first } = textures;
  const heightOf = (name: string) => {
    const height = name === "-" ? null : textures.height(name);
    if (first === null || (height !== null && name !== first)) {
      return height ?? Infinity;
    }
    return vanilla ? (textures.height(first) ?? Infinity) : Infinity;
  };
  let least = Infinity;
  for (const [wall, [one, other]] of wallOwners(map)) {
    if (!other || (one.id !== room.id && other.id !== room.id)) continue;
    if (one === other) {
      least = Math.min(least, heightOf("-"));
      continue;
    }
    const door = one.door ?? other.door;
    for (const side of [one, other]) {
      const name =
        part === "upper" && door
          ? (map.lines?.[wall]?.sides?.[side.id]?.upper ?? door.texture)
          : wallPartTexture(map, side, wall, part);
      least = Math.min(least, heightOf(name));
    }
  }
  return Number.isFinite(least) ? least : null;
}
