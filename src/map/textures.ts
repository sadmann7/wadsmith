import { wallOwners, wallPartTexture } from "./geometry";
import type { GameMap } from "./types";

type TextureUse = Map<string, number>;

function countUse(use: TextureUse, name: string) {
  use.set(name, (use.get(name) ?? 0) + 1);
}

function flatUse(map: GameMap) {
  const use: TextureUse = new Map();
  for (const sector of map.sectors) {
    countUse(use, sector.floorTexture);
    countUse(use, sector.ceilingTexture);
  }
  return use;
}

function wallUse(map: GameMap) {
  const use: TextureUse = new Map();
  for (const [wall, owners] of wallOwners(map)) {
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

export { flatUse, wallUse, type TextureUse };
