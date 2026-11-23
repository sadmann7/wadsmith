import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap, Thing } from "@/lib/map/types";

import { thingCatalog } from "@/lib/map/catalog";
import { atLeast } from "@/lib/map/complevel";
import { type CustomThing, parseDehacked } from "@/lib/map/dehacked";
import { vanillaThings } from "@/lib/map/doom-info";

import type { Lump } from "./compile";

import { readLumps } from "./inspect";

export type CustomThings = ReadonlyMap<number, CustomThing>;

const spriteMarkers = /^S{1,2}_(START|END)$/;
const soundLump = /^D[SP][A-Z0-9_]+$/;

// The things the DEHACKED lumps of the added WADs number. A built map carries
// the lumps in the same order, and the engine applies them one after another.
export function customThingsOf(resources: readonly Uint8Array[]): CustomThings {
  const patches = resources.flatMap(patchesOf);
  return new Map(parseDehacked(...patches).map((thing) => [thing.type, thing]));
}

// The sprites the added WADs carry between their sprite markers, which the
// game's own sprite list leaves out.
export function resourceSprites(
  resources: readonly Uint8Array[],
): Map<string, Uint8Array> {
  const sprites = new Map<string, Uint8Array>();
  for (const resource of resources) {
    let inSprites = false;
    for (const lump of lumpsOf(resource)) {
      if (spriteMarkers.test(lump.name)) {
        inSprites = lump.name.endsWith("START");
      } else if (inSprites) {
        sprites.set(lump.name, lump.data);
      }
    }
  }
  return sprites;
}

export function getUsesCustomThings(maps: readonly GameMap[]) {
  return maps.some((map) =>
    map.things.some((thing) => thing.kind === "custom"),
  );
}

// A map with custom things carries the patches that define them, with the
// sprites and sounds of the WADs they come from, so it plays on its own.
export function modLumps(resources: readonly Uint8Array[]): Lump[] {
  const patches: Lump[] = [];
  const sprites: Lump[] = [];
  const sounds: Lump[] = [];
  for (const resource of resources) {
    const lumps = lumpsOf(resource);
    if (!lumps.some((lump) => lump.name === "DEHACKED")) continue;
    let inSprites = false;
    for (const lump of lumps) {
      if (spriteMarkers.test(lump.name)) {
        inSprites = lump.name.endsWith("START");
        continue;
      }
      if (lump.name === "DEHACKED") patches.push(lump);
      else if (inSprites) sprites.push(lump);
      else if (soundLump.test(lump.name)) sounds.push(lump);
    }
  }
  if (patches.length === 0) return [];
  return [
    ...patches,
    ...(sprites.length > 0
      ? [
          { name: "S_START", data: new Uint8Array() },
          ...sprites,
          { name: "S_END", data: new Uint8Array() },
        ]
      : []),
    ...sounds,
  ];
}

export function thingLabel(
  thing: Pick<Thing, "kind" | "type">,
  custom: CustomThings,
) {
  if (thing.kind !== "custom") return thingCatalog[thing.kind].label;
  const type = thing.type ?? 0;
  return custom.get(type)?.name ?? `Thing ${type}`;
}

// The numbers the engine knows without a patch, like Boom's pushers and
// MBF's dog, which the editor has no name for.
const engineTypes = new Set(
  vanillaThings.map(([type]) => type).filter((type) => type > 0),
);

// A custom thing no added patch numbers is skipped by the game, and one that
// relies on MBF21 loses its MBF21 flags and actions below MBF21, so the map
// check names each number once.
export function customThingWarnings(
  map: GameMap,
  custom: CustomThings,
): CheckedIssue[] {
  const isMbf21Map = atLeast(map.complevel ?? "vanilla", "mbf21");
  const issues = new Map<number, CheckedIssue>();
  for (const thing of map.things) {
    if (thing.kind !== "custom" || thing.type === undefined) continue;
    const { type } = thing;
    if (engineTypes.has(type) || issues.has(type)) continue;
    const defined = custom.get(type);
    if (!defined) {
      issues.set(type, {
        id: `custom-unknown:${type}`,
        severity: "warning",
        message: `Nothing added defines thing ${type}`,
        detail:
          "Add the mod or DEHACKED patch that numbers it, or the game leaves it out.",
        target: thing.id,
      });
    } else if (defined.isMbf21 && !isMbf21Map) {
      issues.set(type, {
        id: `custom-mbf21:${type}`,
        severity: "warning",
        message: `${defined.name} needs MBF21`,
        detail:
          "Its patch uses MBF21 flags or actions, which the game ignores below MBF21. Set Compatibility to MBF21 in Map settings.",
        target: thing.id,
      });
    }
  }
  return [...issues.values()];
}

const decoded = new WeakMap<Uint8Array, string[]>();
const decoder = new TextDecoder("latin1");

function patchesOf(resource: Uint8Array) {
  const known = decoded.get(resource);
  if (known) return known;
  const patches = lumpsOf(resource)
    .filter((lump) => lump.name === "DEHACKED")
    .map((lump) => decoder.decode(lump.data));
  decoded.set(resource, patches);
  return patches;
}

function lumpsOf(resource: Uint8Array) {
  try {
    return readLumps({ name: "resource.wad", data: resource });
  } catch {
    return [];
  }
}
