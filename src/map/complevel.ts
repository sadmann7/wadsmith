import type { Complevel } from "./types";

const complevels: Complevel[] = ["vanilla", "boom", "mbf", "mbf21"];

const complevelLabels: Record<Complevel, string> = {
  vanilla: "Vanilla",
  boom: "Boom",
  mbf: "MBF",
  mbf21: "MBF21",
};

const lastVanillaLine = 141;
const lastVanillaSector = 17;
const linePassUse = 0x0200;
const lineMbf21Flags = 0x3000;
const sectorMbf21Flags = 0x3000;
const mbfSkyLines = new Set([271, 272]);
const mbf21Lines = new Set([1024, 1025, 1026]);
const boomThings = new Set([5001, 5002]);
const mbfHelperDog = 888;

function higherLevel(a: Complevel, b: Complevel): Complevel {
  return complevels.indexOf(a) >= complevels.indexOf(b) ? a : b;
}

function atLeast(level: Complevel, needed: Complevel) {
  return complevels.indexOf(level) >= complevels.indexOf(needed);
}

// The engine that first ran a line special, with the flags on its line.
function lineLevel(special: number, flags = 0): Complevel {
  if (flags & lineMbf21Flags || mbf21Lines.has(special)) return "mbf21";
  if (mbfSkyLines.has(special)) return "mbf";
  if (special > lastVanillaLine || flags & linePassUse) return "boom";
  return "vanilla";
}

function sectorLevel(special: number): Complevel {
  if (special & sectorMbf21Flags) return "mbf21";
  if (special > lastVanillaSector) return "boom";
  return "vanilla";
}

function thingLevel(type: number): Complevel {
  if (type === mbfHelperDog) return "mbf";
  if (boomThings.has(type)) return "boom";
  return "vanilla";
}

export {
  atLeast,
  complevelLabels,
  complevels,
  higherLevel,
  lineLevel,
  linePassUse,
  sectorLevel,
  thingLevel,
};
