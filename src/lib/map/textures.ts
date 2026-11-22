import type { GameMap } from "./types";

import { wallOwners, wallPartTexture } from "./geometry";

export type TextureUse = Map<string, number>;

// The names the game in use has: solid textures for walls, flats, the
// textures for the middle of an open line with the see-through ones first,
// and every texture whatever its use.
export interface TextureNames {
  walls: readonly string[];
  flats: readonly string[];
  middles: readonly string[];
  textures: readonly string[];
}

export function flatUse(map: GameMap) {
  const use: TextureUse = new Map();
  for (const sector of map.sectors) {
    countUse(use, sector.floorTexture);
    countUse(use, sector.ceilingTexture);
  }
  return use;
}

export function wallUse(map: GameMap) {
  const use: TextureUse = new Map();
  for (const [wall, owners] of wallOwners(map)) {
    if (owners.length === 2 && owners[0] === owners[1]) continue;
    const parts =
      owners.length > 1 ? (["upper", "lower"] as const) : (["middle"] as const);
    for (const sector of owners) {
      for (const part of parts) {
        countUse(use, wallPartTexture(map, sector, wall, part));
      }
    }
  }
  return use;
}

function countUse(use: TextureUse, name: string) {
  use.set(name, (use.get(name) ?? 0) + 1);
}
