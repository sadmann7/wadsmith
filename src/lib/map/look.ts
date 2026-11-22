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
// and pegging, or a floor's or ceiling's flat.
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
    offsetX: side?.offsetX,
    offsetY: side?.offsetY,
    upperFixed: line?.upperFixed,
    lowerFixed: line?.lowerFixed,
  };
}

// A wall takes a wall's look and a floor or ceiling takes a flat. Anything
// else, like a door's face or a switch, keeps its own.
export function applyLook(
  map: GameMap,
  key: string | null,
  look: SurfaceLook,
): GameMap {
  const info = describeSurface(map, key);
  if (!key || !info?.sector) return map;
  if (look.kind === "flat") {
    return info.paints === "floor" || info.paints === "ceiling"
      ? paintSurface(map, key, look.texture)
      : map;
  }
  if (info.paints !== "wall" || info.surface.kind !== "wall") return map;
  const { wall } = info.surface;
  return updateLine(
    updateLineSide(paintSurface(map, key, look.texture), wall, info.sector.id, {
      offsetX: look.offsetX,
      offsetY: look.offsetY,
    }),
    wall,
    { upperFixed: look.upperFixed, lowerFixed: look.lowerFixed },
  );
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

// Spreads a height or a brightness evenly over surfaces, from the first one
// picked to the last. A height goes to floors and ceilings, each kept clear of
// the other, and a brightness to the room of every surface.
export function gradient(
  map: GameMap,
  keys: string[],
  what: "height" | "light",
  from: number,
  to: number,
): GameMap {
  const steps = Math.max(1, keys.length - 1);
  return keys.reduce((next, key, index) => {
    const info = describeSurface(next, key);
    const sector = info?.sector;
    if (!info || !sector) return next;
    const value = Math.round(from + ((to - from) * index) / steps);
    if (what === "light") {
      return updateSector(next, sector.id, {
        light: Math.max(0, Math.min(lightLimit, value)),
      });
    }
    if (info.height === null) return next;
    if (info.surface.kind === "floor") {
      const top = sector.door ? heightLimit : sector.ceiling - minimumOpening;
      return updateSector(next, sector.id, {
        floor: Math.max(-heightLimit, Math.min(top, value)),
      });
    }
    return info.surface.kind === "ceiling"
      ? updateSector(next, sector.id, {
          ceiling: Math.min(
            heightLimit,
            Math.max(sector.floor + minimumOpening, value),
          ),
        })
      : next;
  }, map);
}
