import type { GameMap, LineActionKind, Sector } from "@/lib/map/types";

import { generalizedKind } from "@/lib/map/boom";
import { wallOwners } from "@/lib/map/geometry";
import { lineUsesTag } from "@/lib/map/lines";
import { parseSurface } from "@/lib/map/surfaces";

// How far a door stops short of the lowest ceiling beside it when open.
const doorClearance = 4;

// A frame shows the same map as the one before until an edit, so what a frame
// works out from its map is kept with the map, which is never changed in place.
const shown = new WeakMap<GameMap, Map<string, GameMap>>();

// The map as the view draws it: every door shut, and the movers named in
// `opened` as they stand once worked. An open door's ceiling stops just under
// the lowest ceiling beside it, and floors and ceilings rest where Doom's
// EV_DoFloor, EV_DoPlat and EV_DoCeiling stop them.
export function withMovers(map: GameMap, opened: readonly string[]): GameMap {
  const key = opened.toSorted().join(",");
  let cached = shown.get(map);
  if (!cached) {
    cached = new Map();
    shown.set(map, cached);
  }
  const known = cached.get(key);
  if (known) return known;
  const open = new Set(opened.filter((id) => getIsMover(map, id)));
  const beside = open.size > 0 ? neighbours(map) : null;
  const kinds = moverKinds(map);
  const moved = {
    ...map,
    sectors: map.sectors.map((sector) => {
      const around = (open.has(sector.id) && beside?.get(sector.id)) || [];
      if (sector.door) {
        const ceiling =
          around.length > 0
            ? Math.min(...around.map((item) => item.ceiling)) - doorClearance
            : sector.floor;
        return { ...sector, ceiling: Math.max(sector.floor, ceiling) };
      }
      const kind = kinds.get(sector.tag ?? 0);
      return kind && around.length > 0 ? worked(sector, kind, around) : sector;
    }),
  };
  cached.set(key, moved);
  return moved;
}

// A room that moves when worked: a door, or one a floor, ceiling or lift
// action moves.
export function getIsMover(map: GameMap, id: string) {
  const sector = map.sectors.find((item) => item.id === id);
  return Boolean(
    sector && (sector.door || moverKinds(map).has(sector.tag ?? 0)),
  );
}

// The mover a surface belongs to. A wall stands for the mover behind
// it before the room it is in, so a door's face opens the door.
export function moverAt(map: GameMap, key: string | null) {
  const surface = key ? parseSurface(key) : null;
  if (!surface || surface.kind === "thing") return null;
  const behind =
    surface.kind === "wall"
      ? wallOwners(map)
          .get(surface.wall)
          ?.find((item) => item.id !== surface.sector)
      : undefined;
  if (behind && getIsMover(map, behind.id)) return behind.id;
  return getIsMover(map, surface.sector) ? surface.sector : null;
}

const moverKindList = [
  "lift",
  "lift-fast",
  "floor-lower",
  "floor-lower-texture",
  "floor-lower-highest",
  "floor-lower-fast",
  "floor-raise",
  "floor-crush",
  "floor-raise-next",
  "floor-raise-next-fast",
  "floor-raise-next-texture",
  "floor-raise-24",
  "floor-raise-24-texture",
  "floor-raise-32-texture",
  "floor-raise-512",
  "ceiling-lower",
  "ceiling-lower-8",
  "ceiling-raise",
] as const satisfies readonly LineActionKind[];

type MoverKind = (typeof moverKindList)[number];

function worked(sector: Sector, kind: MoverKind, around: Sector[]): Sector {
  const floors = around.map((item) => item.floor);
  const ceilings = around.map((item) => item.ceiling);
  const highest = Math.max(...floors);
  const raiseBy = (amount: number) => ({
    ...sector,
    floor: Math.min(sector.ceiling, sector.floor + amount),
  });
  switch (kind) {
    case "lift":
    case "lift-fast":
    case "floor-lower":
    case "floor-lower-texture":
      return { ...sector, floor: Math.min(sector.floor, ...floors) };
    case "floor-lower-highest":
      return { ...sector, floor: highest };
    case "floor-lower-fast":
      return {
        ...sector,
        floor: highest === sector.floor ? highest : highest + 8,
      };
    case "floor-raise":
      return { ...sector, floor: Math.min(sector.ceiling, ...ceilings) };
    case "floor-crush":
      return { ...sector, floor: Math.min(sector.ceiling, ...ceilings) - 8 };
    case "floor-raise-next":
    case "floor-raise-next-fast":
    case "floor-raise-next-texture": {
      const higher = floors.filter((floor) => floor > sector.floor);
      return higher.length > 0
        ? { ...sector, floor: Math.min(...higher) }
        : sector;
    }
    case "floor-raise-24":
    case "floor-raise-24-texture":
      return raiseBy(24);
    case "floor-raise-32-texture":
      return raiseBy(32);
    case "floor-raise-512":
      return raiseBy(512);
    case "ceiling-lower":
      return { ...sector, ceiling: sector.floor };
    case "ceiling-lower-8":
      return { ...sector, ceiling: sector.floor + 8 };
    case "ceiling-raise":
      return { ...sector, ceiling: Math.max(...ceilings) };
  }
}

const movers = new WeakMap<GameMap, Map<number, MoverKind>>();

// What moves each tagged room, taking the first line that works it.
function moverKinds(map: GameMap) {
  const cached = movers.get(map);
  if (cached) return cached;
  const kinds = new Map<number, MoverKind>();
  for (const line of Object.values(map.lines ?? {})) {
    const { action, raw } = line;
    if (action) {
      if (
        getIsMoverKind(action.kind) &&
        lineUsesTag(action) &&
        action.tag &&
        !kinds.has(action.tag)
      ) {
        kinds.set(action.tag, action.kind);
      }
    } else if (
      raw?.tag &&
      generalizedKind(raw.special)?.class === "lift" &&
      !kinds.has(raw.tag)
    ) {
      kinds.set(raw.tag, "lift");
    }
  }
  movers.set(map, kinds);
  return kinds;
}

function neighbours(map: GameMap) {
  const beside = new Map<string, Sector[]>();
  for (const owners of wallOwners(map).values()) {
    const [one, other] = owners;
    if (!other || one === other) continue;
    beside.set(one.id, [...(beside.get(one.id) ?? []), other]);
    beside.set(other.id, [...(beside.get(other.id) ?? []), one]);
  }
  return beside;
}

const moverKindSet = new Set<LineActionKind>(moverKindList);

function getIsMoverKind(kind: LineActionKind): kind is MoverKind {
  return moverKindSet.has(kind);
}
