import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { setRoomDoor, updateThing } from "../map/edit";
import { testMap } from "../map/test-map";
import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import {
  doomKeys,
  keysByCode,
  startDoom,
  type CreateDoom,
  type DoomGame,
  type GameEvents,
  type GameFiles,
  type Resolution,
} from "./runtime";

const engineDirectory = resolve(import.meta.dirname, "../../public/engine");
export const ready = existsSync(resolve(engineDirectory, "woof.js"));

const running: DoomGame[] = [];

export function stopGames() {
  for (const game of running.splice(0)) game.stop();
}

export const engineWarnings: string[] = [];

export async function launch(
  map: GameMap | Uint8Array | GameFiles,
  sampleRate: number | null = null,
  events?: GameEvents,
  resolution?: Resolution,
) {
  const url = pathToFileURL(resolve(engineDirectory, "woof.js")).href;
  const { default: createDoom } = (await import(/* @vite-ignore */ url)) as {
    default: CreateDoom;
  };
  const game = await startDoom({
    createDoom,
    iwad: readFileSync(resolve(engineDirectory, "freedoom2.wad")),
    base: readFileSync(resolve(engineDirectory, "woof.pk3")),
    ...("wads" in map
      ? map
      : { wads: [map instanceof Uint8Array ? map : compileMap(map)] }),
    options: { print: () => {}, printErr: (line) => engineWarnings.push(line) },
    events,
    sampleRate,
    resolution,
  });
  running.push(game);
  return game;
}

export async function play(_game: DoomGame, ms: number, until?: () => boolean) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (until?.()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
}

export const openMap: GameMap = {
  ...setRoomDoor(testMap, "sector-4", undefined),
  switches: [],
};
export const doorIndex = testMap.sectors.findIndex((sector) => sector.door);
export const doorFloor = testMap.sectors[doorIndex].floor;

export function playerAt(map: GameMap, x: number, y: number, angle: number) {
  return updateThing(map, "player-1", { x, y, angle });
}

// Game time stands still during the opening screen melt, so input there is lost.
export async function waitForPlay(game: DoomGame) {
  const startTic = game.gameTic();
  await play(game, 10_000, () => game.gameTic() > startTic + 5);
}

export async function pressUse(game: DoomGame) {
  game.key(true, doomKeys.use);
  await play(game, 150);
  game.key(false, doomKeys.use);
}

export async function holdKey(game: DoomGame, code: string, ms = 400) {
  const key = keysByCode[code];
  game.key(true, key);
  await play(game, ms);
  game.key(false, key);
  await play(game, 500);
}
