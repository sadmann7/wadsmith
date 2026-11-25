import type { Complevel, GameMap, LineSettings } from "./types";

export const complevels: Complevel[] = ["vanilla", "boom", "mbf", "mbf21"];

export const complevelLabels: Record<Complevel, string> = {
  vanilla: "Vanilla",
  boom: "Boom",
  mbf: "MBF",
  mbf21: "MBF21",
};

const lastVanillaLine = 141;
const lastVanillaSector = 17;
export const linePassUse = 0x0200;
export const lineBlocksWalkers = 0x1000;
export const lineBlocksPlayers = 0x2000;
const lineMbf21Flags = lineBlocksWalkers | lineBlocksPlayers;
const sectorMbf21Flags = 0x3000;
const mbfSkyLines = new Set([271, 272]);
const mbf21Lines = new Set([1024, 1025, 1026]);
const boomThings = new Set([5001, 5002]);
const mbfHelperDog = 888;

export function higherLevel(a: Complevel, b: Complevel): Complevel {
  return complevels.indexOf(a) >= complevels.indexOf(b) ? a : b;
}

export function atLeast(level: Complevel, needed: Complevel) {
  return complevels.indexOf(level) >= complevels.indexOf(needed);
}

// The engine that first ran a line special, with the flags on its line.
export function lineLevel(special: number, flags = 0): Complevel {
  if (flags & lineMbf21Flags || mbf21Lines.has(special)) return "mbf21";
  if (mbfSkyLines.has(special)) return "mbf";
  if (special > lastVanillaLine || flags & linePassUse) return "boom";
  return "vanilla";
}

// The game skips a line's MBF21 flags below MBF21.
export function getBlocksPlayer(map: GameMap, line: LineSettings | undefined) {
  return Boolean(
    line?.blocksAll ||
    (line?.blocksPlayers && atLeast(map.complevel ?? "vanilla", "mbf21")),
  );
}

export function sectorLevel(special: number): Complevel {
  if (special & sectorMbf21Flags) return "mbf21";
  if (special > lastVanillaSector) return "boom";
  return "vanilla";
}

export function thingLevel(type: number): Complevel {
  if (type === mbfHelperDog) return "mbf";
  if (boomThings.has(type)) return "boom";
  return "vanilla";
}
