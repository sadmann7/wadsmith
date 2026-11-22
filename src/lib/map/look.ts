import type { GameMap } from "./types";

import { updateLine, updateLineSide, updateSector } from "./edit";
import { wallOwners } from "./geometry";
import {
  describeSurface,
  paintSurface,
  parseSurface,
  surfaceKey,
  type WallPart,
} from "./surfaces";

// How a surface looks, to put on another: a wall's texture with its offsets
// and pegging, or a floor's or ceiling's flat. A look without offsets or
// pegging leaves those as they are on the wall that takes it.
export interface SurfaceLook {
  kind: "wall" | "flat";
  texture: string;
  offsetX?: number;
  offsetY?: number;
  upperFixed?: boolean;
  lowerFixed?: boolean;
}

const wallParts: WallPart[] = ["upper", "lower", "middle"];
const lightLimit = 255;
const minimumOpening = 8;
const heightLimit = 2048;

export function lookOf(map: GameMap, key: string | null): SurfaceLook | null {
  const info = describeSurface(map, key);
  if (!info?.texture || !info.sector) return null;
  if (info.paints === "floor" || info.paints === "ceiling") {
    return { kind: "flat", texture: info.texture };
  }
  if (info.paints !== "wall" || info.surface.kind !== "wall") return null;
  const line = map.lines?.[info.surface.wall];
  const side = line?.sides?.[info.sector.id];
  return {
    kind: "wall",
    texture: info.texture,
    offsetX: side?.offsetX ?? 0,
    offsetY: side?.offsetY ?? 0,
    upperFixed: line?.upperFixed ?? false,
    lowerFixed: line?.lowerFixed ?? false,
  };
}

// A wall takes a wall's look and a floor or ceiling takes a flat. Anything
// else, like a door's face or a switch, keeps its own.
export function getCanTakeLook(
  map: GameMap,
  key: string | null,
  look: SurfaceLook,
) {
  const info = describeSurface(map, key);
  if (!info?.sector) return false;
  return look.kind === "flat"
    ? info.paints === "floor" || info.paints === "ceiling"
    : info.paints === "wall" && info.surface.kind === "wall";
}

// The same map comes back when the surface can't take the look or already
// wears it.
export function applyLook(
  map: GameMap,
  key: string | null,
  look: SurfaceLook,
): GameMap {
  const info = describeSurface(map, key);
  if (!key || !info?.sector || !getCanTakeLook(map, key, look)) return map;
  const painted =
    info.texture === look.texture ? map : paintSurface(map, key, look.texture);
  if (info.surface.kind !== "wall") return painted;
  const { wall } = info.surface;
  const line = map.lines?.[wall];
  const side = line?.sides?.[info.sector.id];
  const offsetX = look.offsetX ?? side?.offsetX ?? 0;
  const offsetY = look.offsetY ?? side?.offsetY ?? 0;
  const upperFixed = look.upperFixed ?? line?.upperFixed ?? false;
  const lowerFixed = look.lowerFixed ?? line?.lowerFixed ?? false;
  const moved =
    offsetX === (side?.offsetX ?? 0) && offsetY === (side?.offsetY ?? 0)
      ? painted
      : updateLineSide(painted, wall, info.sector.id, {
          offsetX: offsetX || undefined,
          offsetY: offsetY || undefined,
        });
  return upperFixed === (line?.upperFixed ?? false) &&
    lowerFixed === (line?.lowerFixed ?? false)
    ? moved
    : updateLine(moved, wall, {
        upperFixed: upperFixed || undefined,
        lowerFixed: lowerFixed || undefined,
      });
}

// Paints a texture over a wall and on along every wall joined to it, corner
// to corner, for as long as they show the texture the first one did.
export function floodWalls(
  map: GameMap,
  key: string | null,
  texture: string,
): GameMap {
  const start = describeSurface(map, key);
  if (!key || start?.paints !== "wall" || !start.texture) return map;
  const old = start.texture;
  if (old === texture) return map;
  const owners = wallOwners(map);
  const corners = new Map<string, string[]>();
  for (const wall of owners.keys()) {
    for (const corner of wall.split("|")) {
      corners.set(corner, [...(corners.get(corner) ?? []), wall]);
    }
  }
  // Every part of a wall that shows the old texture, on either side.
  const showing = (wall: string) =>
    [...new Set(owners.get(wall) ?? [])].flatMap((sector) =>
      wallParts
        .map((part) =>
          surfaceKey({ kind: "wall", sector: sector.id, wall, part }),
        )
        .filter((surface) => {
          const info = describeSurface(map, surface);
          return info?.paints === "wall" && info.texture === old;
        }),
    );
  const first = parseSurface(key);
  if (first?.kind !== "wall") return map;
  const reached = new Set([first.wall]);
  const queue = [first.wall];
  let next = map;
  for (let at = 0; at < queue.length; at += 1) {
    const surfaces = showing(queue[at]);
    if (surfaces.length === 0) continue;
    for (const surface of surfaces) next = paintSurface(next, surface, texture);
    for (const corner of queue[at].split("|")) {
      for (const beside of corners.get(corner) ?? []) {
        if (reached.has(beside)) continue;
        reached.add(beside);
        queue.push(beside);
      }
    }
  }
  return next;
}

export type GradientKind = "height" | "light";

// What the first and last surfaces of a gradient hold now, or null when none
// of the surfaces takes one.
export function gradientEnds(
  map: GameMap,
  keys: string[],
  what: GradientKind,
): [number, number] | null {
  const takers = gradientTakers(map, keys, what);
  if (takers.length === 0) return null;
  const valueOf = (key: string) => {
    const info = describeSurface(map, key);
    return (what === "light" ? info?.sector?.light : info?.height) ?? 0;
  };
  return [valueOf(takers[0]), valueOf(takers[takers.length - 1])];
}

// Spreads a height or a brightness evenly over surfaces, from the first one
// picked to the last. A height goes to floors and ceilings, each kept clear of
// the other, and a brightness to the room of every surface. The same map
// comes back when nothing changes.
export function gradient(
  map: GameMap,
  keys: string[],
  what: GradientKind,
  from: number,
  to: number,
): GameMap {
  const takers = gradientTakers(map, keys, what);
  const steps = Math.max(1, takers.length - 1);
  return takers.reduce((next, key, index) => {
    const info = describeSurface(next, key);
    const sector = info?.sector;
    if (!info || !sector) return next;
    const value = Math.round(from + ((to - from) * index) / steps);
    if (what === "light") {
      const light = Math.max(0, Math.min(lightLimit, value));
      return light === sector.light
        ? next
        : updateSector(next, sector.id, { light });
    }
    if (info.surface.kind === "floor") {
      const top = sector.door ? heightLimit : sector.ceiling - minimumOpening;
      const floor = Math.max(-heightLimit, Math.min(top, value));
      return floor === sector.floor
        ? next
        : updateSector(next, sector.id, { floor });
    }
    const ceiling = Math.min(
      heightLimit,
      Math.max(sector.floor + minimumOpening, value),
    );
    return ceiling === sector.ceiling
      ? next
      : updateSector(next, sector.id, { ceiling });
  }, map);
}

// The surfaces a gradient steps over, in the order picked: floors and
// ceilings for a height, and one surface of each room for a brightness.
function gradientTakers(map: GameMap, keys: string[], what: GradientKind) {
  const rooms = new Set<string>();
  return keys.filter((key) => {
    const info = describeSurface(map, key);
    if (!info?.sector) return false;
    if (what === "height") {
      const { kind } = info.surface;
      return info.height !== null && (kind === "floor" || kind === "ceiling");
    }
    if (rooms.has(info.sector.id)) return false;
    rooms.add(info.sector.id);
    return true;
  });
}
