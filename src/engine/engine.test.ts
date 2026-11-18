import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { setRoomDoor, updateThing } from "../map/edit";
import { starterMap } from "../map/starter-map";
import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import { doomKeys, startDoom, type CreateDoom, type DoomGame } from "./runtime";

const engineDirectory = resolve(import.meta.dirname, "../../public/engine");
const ready = existsSync(resolve(engineDirectory, "websockets-doom.js"));

const running: DoomGame[] = [];

afterEach(() => {
  for (const game of running.splice(0)) game.stop();
});

async function launch(map: GameMap) {
  const url = pathToFileURL(
    resolve(engineDirectory, "websockets-doom.js"),
  ).href;
  const { default: createDoom } = (await import(/* @vite-ignore */ url)) as {
    default: CreateDoom;
  };
  const game = await startDoom({
    createDoom,
    iwad: readFileSync(resolve(engineDirectory, "freedoom2.wad")),
    map: compileMap(map),
    options: { print: () => {}, printErr: () => {} },
    sound: false,
  });
  running.push(game);
  return game;
}

async function play(_game: DoomGame, ms: number, until?: () => boolean) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (until?.()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
}

const openMap: GameMap = {
  ...setRoomDoor(starterMap, "sector-4", undefined),
  switches: [],
};
const doorIndex = starterMap.sectors.findIndex((sector) => sector.door);
const doorFloor = starterMap.sectors[doorIndex].floor;

function playerAt(map: GameMap, x: number, y: number, angle: number) {
  return updateThing(map, "player-1", { x, y, angle });
}

// Game time stands still during the opening screen melt, so input there is lost.
async function waitForPlay(game: DoomGame) {
  const startTic = game.gameTic();
  await play(game, 10_000, () => game.gameTic() > startTic + 5);
}

async function pressUse(game: DoomGame) {
  game.key(true, doomKeys.use);
  await play(game, 150);
  game.key(false, doomKeys.use);
}

describe.skipIf(!ready)("generated map in the engine", () => {
  it("loads the level at the player start", async () => {
    const game = await launch(openMap);
    await waitForPlay(game);
    const status = game.status();
    expect(status.inLevel).toBe(true);
    expect(status.health).toBe(100);
    expect(status.x).toBe(96);
    expect(status.y).toBe(-160);
    expect(status.totalKills).toBe(2);
  }, 30_000);

  it("walks through a portal and kills a monster", async () => {
    const game = await launch(openMap);
    await waitForPlay(game);
    game.key(true, doomKeys.up);
    game.key(true, doomKeys.fire);
    await play(game, 25_000, () => {
      const { kills, x } = game.status();
      return kills > 0 && x > 520;
    });
    const status = game.status();
    expect(status.x).toBeGreaterThan(520);
    expect(status.kills).toBeGreaterThan(0);
  }, 40_000);

  it("reports a map the engine refuses", async () => {
    await expect(launch({ ...openMap, things: [] })).rejects.toBeDefined();
  }, 30_000);

  it("opens a door from a connected switch", async () => {
    const game = await launch(playerAt(starterMap, 192, 40, 90));
    await waitForPlay(game);
    expect(game.sectorCeiling(doorIndex)).toBe(doorFloor);
    await pressUse(game);
    await play(game, 2000);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 30_000);

  it("ignores the use key on a switch-only door", async () => {
    const game = await launch(playerAt(starterMap, 450, 160, 0));
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 800);
    expect(game.sectorCeiling(doorIndex)).toBe(doorFloor);
  }, 30_000);

  it("opens a use door and closes it again", async () => {
    const door = starterMap.sectors[doorIndex].door!;
    const map = playerAt(
      setRoomDoor(starterMap, "sector-4", {
        ...door,
        opensBy: "use",
        closes: true,
      }),
      450,
      160,
      0,
    );
    const game = await launch({
      ...map,
      switches: [],
      // A monster walking into the doorway would hold the door open.
      things: map.things.filter((thing) => thing.kind === "player"),
    });
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 2000);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
    await play(game, 7000, () => game.sectorCeiling(doorIndex) === doorFloor);
    expect(game.sectorCeiling(doorIndex)).toBe(doorFloor);
  }, 30_000);

  it("lets the player shoot a monster through an opened door", async () => {
    const door = starterMap.sectors[doorIndex].door!;
    const map = playerAt(
      setRoomDoor(starterMap, "sector-4", { ...door, opensBy: "use" }),
      450,
      160,
      0,
    );
    const game = await launch({ ...map, switches: [] });
    await waitForPlay(game);
    game.key(true, doomKeys.fire);
    await play(game, 1000);
    expect(game.status().kills).toBe(0);
    await pressUse(game);
    await play(game, 20_000, () => game.status().kills > 0);
    expect(game.status().kills).toBeGreaterThan(0);
  }, 30_000);
});
