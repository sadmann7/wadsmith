import type { GameMap, Sector } from "@/lib/map/types";

import { generalizedKind } from "@/lib/map/boom";
import { wallOwners } from "@/lib/map/geometry";
import { lineUsesTag } from "@/lib/map/lines";
import { parseSurface } from "@/lib/map/surfaces";

// How far a door stops short of the lowest ceiling beside it when open.
const doorClearance = 4;

// A frame shows the same map as the one before until an edit, so what a frame
// works out from its map is kept with the map, which is never changed in place.
const shown = new WeakMap<GameMap, Map<string, GameMap>>();

// The map as the view draws it: every door shut, and the doors and lifts named
// in `opened` as they stand once worked. An open door's ceiling stops just
// under the lowest ceiling beside it, and a lowered lift's floor sits at the
// lowest floor beside it.
export function withMovers(map: GameMap, opened: readonly string[]): GameMap {
  const key = opened.toSorted().join(",");
  let cached = shown.get(map);
  if (!cached) {
    cached = new Map();
    shown.set(map, cached);
  }
  const known = cached.get(key);
  if (known) return known;
  const open = new Set(opened);
  const beside = open.size > 0 ? neighbours(map) : null;
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
      return around.length > 0
        ? {
            ...sector,
            floor: Math.min(sector.floor, ...around.map((item) => item.floor)),
          }
        : sector;
    }),
  };
  cached.set(key, moved);
  return moved;
}

// The door or lift a surface belongs to: a door's own room, the door behind a
// wall that wears its face, or a room a lift action lowers.
export function moverAt(map: GameMap, key: string | null) {
  const surface = key ? parseSurface(key) : null;
  if (!surface || surface.kind === "thing") return null;
  const sector = map.sectors.find((item) => item.id === surface.sector);
  if (!sector) return null;
  if (sector.door || liftTags(map).has(sector.tag ?? 0)) return sector.id;
  if (surface.kind !== "wall") return null;
  const behind = wallOwners(map)
    .get(surface.wall)
    ?.find((item) => item !== sector);
  return behind && (behind.door || liftTags(map).has(behind.tag ?? 0))
    ? behind.id
    : null;
}

const lifts = new WeakMap<GameMap, Set<number>>();

function liftTags(map: GameMap) {
  const cached = lifts.get(map);
  if (cached) return cached;
  const tags = new Set<number>();
  for (const line of Object.values(map.lines ?? {})) {
    const { action, raw } = line;
    if (action) {
      const lowers = action.kind === "lift" || action.kind === "lift-fast";
      if (lowers && lineUsesTag(action) && action.tag) tags.add(action.tag);
    } else if (raw?.tag && generalizedKind(raw.special)?.class === "lift") {
      tags.add(raw.tag);
    }
  }
  lifts.set(map, tags);
  return tags;
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
