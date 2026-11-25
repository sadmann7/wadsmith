import type { TextureSource } from "@/lib/wad/resources";

import {
  listStoredFiles,
  readStoredFile,
  writeStoredFile,
} from "@/lib/episodes/episode-store";
import { customThingsOf } from "@/lib/wad/custom-things";
import { getIsWad, readLumps, WadFileError } from "@/lib/wad/inspect";
import { getHasTextures } from "@/lib/wad/resources";

import { defaultGame, type GameInfo, games } from "./game";

// A texture WAD a person added, laid over the game's own textures.
export interface Resource {
  id: string;
  name: string;
  data: Uint8Array;
}

export interface Iwad {
  game: GameInfo;
  data: Uint8Array;
  // Whether the IWAD is one the person brought, rather than the bundled Freedoom.
  own: boolean;
  resources: Resource[];
}

export const engineBase = "/engine/";

const storedKey = "iwad";
const resourcePrefix = "resource:";

let iwad: Promise<Iwad> | null = null;
const changes = new EventTarget();

// A WAD marked as a game, with Doom's palette, textures and a first map, can
// be the game; megawads carry the same lumps but say PWAD. The Doom II games
// are told apart by name, as the engine does.
export function identifyIwad(name: string, data: Uint8Array): GameInfo {
  const lumps = new Set(readLumps({ name, data }).map((lump) => lump.name));
  const base = name.replace(/^.*[\\/]/, "").toLowerCase();
  const marked = new TextDecoder("latin1").decode(data.subarray(0, 4));
  if (
    marked !== "IWAD" ||
    !["PLAYPAL", "COLORMAP", "TEXTURE1", "PNAMES"].every((l) => lumps.has(l))
  ) {
    throw new WadFileError(`${name} isn't a game IWAD.`);
  }
  const freedoom = lumps.has("FREEDOOM") || /freedoom/.test(base);
  if (lumps.has("MAP01")) {
    if (freedoom) return games.freedoom2;
    if (/plutonia/.test(base)) return games.plutonia;
    if (/tnt|evilution/.test(base)) return games.tnt;
    return games.doom2;
  }
  if (!lumps.has("E1M1")) {
    throw new WadFileError(`${name} has no maps, so it isn't a game IWAD.`);
  }
  if (!lumps.has("E2M1")) {
    throw new WadFileError(
      `${name} is the shareware Doom, which can't load other maps.`,
    );
  }
  const episodes = lumps.has("E4M1") ? 4 : 3;
  if (freedoom) return { ...games.freedoom1, episodes };
  return {
    ...games.doom,
    episodes,
    label: episodes === 4 ? games.doom.label : "Doom",
  };
}

export function loadIwad() {
  iwad ??= readIwad().catch((error: unknown) => {
    iwad = null;
    throw error;
  });
  return iwad;
}

// The file stays in this browser; nothing uploads it.
export async function adoptOwnIwad(name: string, data: Uint8Array) {
  const game = identifyIwad(name, data);
  await writeStoredFile(storedKey, { key: storedKey, name, data });
  announce();
  return game;
}

export async function restoreBundledIwad() {
  await writeStoredFile(storedKey, null);
  announce();
}

// Like the IWAD, a resource stays in this browser.
export async function addResource(name: string, data: Uint8Array) {
  let useful = false;
  try {
    useful =
      getIsWad(data) &&
      (getHasTextures(data) || customThingsOf([data]).size > 0);
  } catch {
    useful = false;
  }
  if (!useful) {
    throw new WadFileError(
      `${name} has no textures, flats or numbered things in it.`,
    );
  }
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `${resourcePrefix}${id}`;
  await writeStoredFile(key, { key, name, data });
  announce();
  return { id, name, data } satisfies Resource;
}

export async function removeResource(id: string) {
  await writeStoredFile(`${resourcePrefix}${id}`, null);
  announce();
}

export function texturesOf(iwad: Iwad): TextureSource {
  return {
    iwad: iwad.data,
    resources: iwad.resources.map((resource) => resource.data),
  };
}

export function onIwadChange(listener: () => void) {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
}

// A stored IWAD the browser can no longer read falls back to Freedoom.
async function readIwad(): Promise<Iwad> {
  const [stored, files] = await Promise.all([
    readStoredFile(storedKey),
    listStoredFiles(resourcePrefix),
  ]);
  // The files come in key order, and a key starts with the time it was
  // added, so a later resource lies over an earlier one.
  const resources = files.map(({ key, name, data }) => ({
    id: key.slice(resourcePrefix.length),
    name,
    data,
  }));
  if (stored) {
    try {
      return {
        game: identifyIwad(stored.name, stored.data),
        data: stored.data,
        own: true,
        resources,
      };
    } catch {
      return { ...(await fetchFreedoom()), resources };
    }
  }
  return { ...(await fetchFreedoom()), resources };
}

// Hosts don't compress WAD files, so setup:engine writes this one gzipped.
const iwadFile = "freedoom-0.13.0.wad.gz";

export async function fetchFreedoom(): Promise<Omit<Iwad, "resources">> {
  const response = await fetch(`${engineBase}${iwadFile}`);
  if (!response.ok || !response.body) {
    throw new Error(`${iwadFile} is missing.`);
  }
  const data = response.body.pipeThrough(new DecompressionStream("gzip"));
  return {
    game: defaultGame,
    data: new Uint8Array(await new Response(data).arrayBuffer()),
    own: false,
  };
}

function announce() {
  iwad = null;
  changes.dispatchEvent(new Event("change"));
}
