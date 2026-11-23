import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap, Thing } from "@/lib/map/types";

import { thingCatalog } from "@/lib/map/catalog";
import { type CustomThing, parseDehacked } from "@/lib/map/dehacked";
import { vanillaThings } from "@/lib/map/doom-info";

import type { Lump } from "./compile";

import { readLumps } from "./inspect";

export type CustomThings = ReadonlyMap<number, CustomThing>;

const spriteMarkers = /^S{1,2}_(START|END)$/;
const soundLump = /^D[SP][A-Z0-9_]+$/;

// The things the DEHACKED lumps of the added WADs number, later WADs taking
// a number over from earlier ones, as the engine loads them.
export function customThingsOf(resources: readonly Uint8Array[]): CustomThings {
  const things = new Map<number, CustomThing>();
  for (const resource of resources) {
    for (const thing of patchedThings(resource)) things.set(thing.type, thing);
  }
  return things;
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

// A custom thing no added patch numbers is skipped by the game, so the map
// check names each number once.
export function customThingWarnings(
  map: GameMap,
  custom: CustomThings,
): CheckedIssue[] {
  const missing = new Map<number, string>();
  for (const thing of map.things) {
    if (thing.kind !== "custom" || thing.type === undefined) continue;
    if (engineTypes.has(thing.type)) continue;
    if (!custom.has(thing.type) && !missing.has(thing.type)) {
      missing.set(thing.type, thing.id);
    }
  }
  return [...missing].map(([type, target]) => ({
    id: `custom-unknown:${type}`,
    severity: "warning",
    message: `Nothing added defines thing ${type}`,
    detail:
      "Add the mod or DEHACKED patch that numbers it, or the game leaves it out.",
    target,
  }));
}

const parsed = new WeakMap<Uint8Array, CustomThing[]>();
const decoder = new TextDecoder("latin1");

function patchedThings(resource: Uint8Array) {
  const known = parsed.get(resource);
  if (known) return known;
  const things = lumpsOf(resource)
    .filter((lump) => lump.name === "DEHACKED")
    .flatMap((lump) => parseDehacked(decoder.decode(lump.data)));
  parsed.set(resource, things);
  return things;
}

function lumpsOf(resource: Uint8Array) {
  try {
    return readLumps({ name: "resource.wad", data: resource });
  } catch {
    return [];
  }
}
