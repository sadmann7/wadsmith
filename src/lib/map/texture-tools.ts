import type { GameMap, Sector } from "./types";

import { updateLineSide, updateSector } from "./edit";
import {
  engineOrder,
  loopEdges,
  sectorLoops,
  wallKey,
  wallOwners,
  wallPartTexture,
} from "./geometry";

export type TextureKind = "wall" | "flat";

const fallbackWidth = 64;

// Runs a room's texture on unbroken from one wall: each wall beside it that
// shows the same texture starts where the last one ended, both ways round the
// room, until a wall shows something else. `widthOf` gives a texture's width,
// which the offsets wrap at.
export function alignWalls(
  map: GameMap,
  sectorId: string,
  wall: string,
  widthOf: (texture: string) => number,
): GameMap {
  const sector = map.sectors.find((item) => item.id === sectorId);
  if (!sector) return map;
  const owners = wallOwners(map);
  const shown = (key: string) =>
    (owners.get(key)?.length ?? 0) > 1
      ? [
          wallPartTexture(map, sector, key, "upper"),
          wallPartTexture(map, sector, key, "lower"),
        ]
      : [wallPartTexture(map, sector, key, "middle")];
  for (const [at, loop] of sectorLoops(sector).entries()) {
    const edges = loopEdges(engineOrder(map, loop, at > 0)).map((edge) => ({
      key: wallKey(edge.from, edge.to),
      length: Math.round(
        Math.hypot(
          map.vertices[edge.to].x - map.vertices[edge.from].x,
          map.vertices[edge.to].y - map.vertices[edge.from].y,
        ),
      ),
    }));
    const start = edges.findIndex((edge) => edge.key === wall);
    if (start < 0) continue;
    const textures = shown(wall);
    const width = Math.max(widthOf(textures[0]), 1);
    const span = width > 1 ? width : fallbackWidth;
    const carries = (key: string) =>
      shown(key).some((texture) => textures.includes(texture));
    const offsets = new Map([
      [wall, map.lines?.[wall]?.sides?.[sector.id]?.offsetX ?? 0],
    ]);
    const count = edges.length;
    let offset = offsets.get(wall) ?? 0;
    for (let step = 1; step < count; step += 1) {
      const edge = edges[(start + step) % count];
      if (!carries(edge.key)) break;
      offset += edges[(start + step - 1) % count].length;
      offsets.set(edge.key, offset);
    }
    offset = offsets.get(wall) ?? 0;
    for (let step = 1; step < count; step += 1) {
      const edge = edges[(start - step + count) % count];
      if (offsets.has(edge.key) || !carries(edge.key)) break;
      offset -= edge.length;
      offsets.set(edge.key, offset);
    }
    return [...offsets].reduce((next, [key, value]) => {
      const wrapped = ((value % span) + span) % span;
      const current = next.lines?.[key]?.sides?.[sector.id]?.offsetX ?? 0;
      return wrapped === current
        ? next
        : updateLineSide(next, key, sector.id, {
            offsetX: wrapped || undefined,
          });
    }, map);
  }
  return map;
}

// How many places show a texture: room walls, single walls and the parts of
// line sides for a wall texture, floors and ceilings for a flat. A door's and
// a switch's own face stay as they are, since each takes a face of its kind.
export function countTexture(map: GameMap, name: string, kind: TextureKind) {
  return replaceTexture(map, name, name, kind).count;
}

export function replaceTexture(
  map: GameMap,
  from: string,
  to: string,
  kind: TextureKind,
): { map: GameMap; count: number } {
  let count = 0;
  const swap = (texture: string) => {
    if (texture !== from) return texture;
    count += 1;
    return to;
  };
  if (kind === "flat") {
    const sectors = map.sectors.map((sector) =>
      sector.floorTexture === from || sector.ceilingTexture === from
        ? {
            ...sector,
            floorTexture: swap(sector.floorTexture),
            ceilingTexture: swap(sector.ceilingTexture),
          }
        : sector,
    );
    return { map: count > 0 ? { ...map, sectors } : map, count };
  }
  let next = map.sectors.reduce((changed, sector) => {
    const patch = wallPatch(sector, swap);
    return patch ? updateSector(changed, sector.id, patch) : changed;
  }, map);
  for (const [wall, line] of Object.entries(map.lines ?? {})) {
    for (const [sector, side] of Object.entries(line.sides ?? {})) {
      const parts = (["upper", "lower", "middle"] as const).filter(
        (part) => side[part] === from,
      );
      if (parts.length === 0) continue;
      count += parts.length;
      next = updateLineSide(
        next,
        wall,
        sector,
        Object.fromEntries(parts.map((part) => [part, to])),
      );
    }
  }
  return { map: count > 0 ? next : map, count };
}

function wallPatch(sector: Sector, swap: (texture: string) => string) {
  const wallTexture = swap(sector.wallTexture);
  const overrides = sector.wallOverrides
    ? Object.fromEntries(
        Object.entries(sector.wallOverrides).map(([wall, texture]) => [
          wall,
          swap(texture),
        ]),
      )
    : undefined;
  const changed =
    wallTexture !== sector.wallTexture ||
    Object.entries(overrides ?? {}).some(
      ([wall, texture]) => texture !== sector.wallOverrides?.[wall],
    );
  return changed
    ? { wallTexture, ...(overrides ? { wallOverrides: overrides } : {}) }
    : null;
}
