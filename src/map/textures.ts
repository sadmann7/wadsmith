import { sectorEdges, wallKey, wallOwners, wallPartTexture } from "./geometry";
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
  const owners = wallOwners(map);
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const wall = wallKey(from, to);
      const parts =
        (owners.get(wall)?.length ?? 0) > 1
          ? (["upper", "lower"] as const)
          : (["middle"] as const);
      for (const part of parts) {
        countUse(use, wallPartTexture(map, sector, wall, part));
      }
    }
  }
  return use;
}

export { flatUse, wallUse, type TextureUse };
