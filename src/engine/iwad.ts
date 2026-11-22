import { readStoredFile, writeStoredFile } from "@/episodes/episode-store";
import { WadFileError, readLumps } from "@/wad/inspect";
import { defaultGame, games, type GameInfo } from "./game";

interface Iwad {
  game: GameInfo;
  data: Uint8Array;
  // Whether the IWAD is one the person brought, rather than the bundled Freedoom.
  own: boolean;
}

const engineBase = "/engine/";
// Hosts don't compress WAD files, so setup:engine writes this one gzipped.
const iwadFile = "freedoom-0.13.0.wad.gz";
const storedKey = "iwad";

let iwad: Promise<Iwad> | null = null;
const changes = new EventTarget();

// A WAD marked as a game, with Doom's palette, textures and a first map, can
// be the game; megawads carry the same lumps but say PWAD. The Doom II games
// are told apart by name, as the engine does.
function identifyIwad(name: string, data: Uint8Array): GameInfo {
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

async function fetchFreedoom(): Promise<Iwad> {
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

// A stored IWAD the browser can no longer read falls back to Freedoom.
async function readIwad(): Promise<Iwad> {
  const stored = await readStoredFile(storedKey);
  if (stored) {
    try {
      return {
        game: identifyIwad(stored.name, stored.data),
        data: stored.data,
        own: true,
      };
    } catch {
      return fetchFreedoom();
    }
  }
  return fetchFreedoom();
}

function loadIwad() {
  iwad ??= readIwad().catch((error: unknown) => {
    iwad = null;
    throw error;
  });
  return iwad;
}

function announce() {
  iwad = null;
  changes.dispatchEvent(new Event("change"));
}

// The file stays in this browser; nothing uploads it.
async function adoptOwnIwad(name: string, data: Uint8Array) {
  const game = identifyIwad(name, data);
  await writeStoredFile(storedKey, { key: storedKey, name, data });
  announce();
  return game;
}

async function restoreBundledIwad() {
  await writeStoredFile(storedKey, null);
  announce();
}

function onIwadChange(listener: () => void) {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
}

export {
  adoptOwnIwad,
  engineBase,
  identifyIwad,
  loadIwad,
  onIwadChange,
  restoreBundledIwad,
  type Iwad,
};
