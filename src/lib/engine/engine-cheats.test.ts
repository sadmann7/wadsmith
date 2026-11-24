import { afterEach, describe, expect, it } from "vitest";

import { updateSector } from "@/lib/map/edit";

import { keysByCode, noCheats } from "./runtime";
import {
  launch,
  openMap,
  play,
  playerAt,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";

afterEach(stopGames);

describe.skipIf(!ready)("playtest cheats in the engine", () => {
  it("keeps the player alive on a damaging floor in god mode", async () => {
    const burning = updateSector(openMap, "sector-1", { effect: "damage-20" });
    const game = await launch(burning);
    await waitForPlay(game);
    await play(game, 5000, () => game.status().health < 100);
    expect(game.status().health).toBeLessThan(100);

    game.setCheats({ ...noCheats, god: true });
    expect(game.cheats()).toEqual({ god: true, noclip: false });
    expect(game.status().health).toBe(100);
    await play(game, 3000);
    expect(game.status().health).toBe(100);

    game.setCheats(noCheats);
    await play(game, 5000, () => game.status().health < 100);
    expect(game.status().health).toBeLessThan(100);
  }, 30_000);

  it("still ends the level on a damage-exit floor in god mode", async () => {
    const exitFloor = updateSector(openMap, "sector-1", {
      effect: "damage-20-exit",
    });
    const game = await launch(exitFloor);
    await waitForPlay(game);
    game.setCheats({ ...noCheats, god: true });
    expect(game.cheats().god).toBe(true);
    await play(game, 15_000, () => !game.status().inLevel);
    expect(game.status().inLevel).toBe(false);
  }, 30_000);

  it("walks through a wall with no clipping", async () => {
    const distance = async (noclip: boolean) => {
      const game = await launch(playerAt(openMap, 300, 280, 0));
      await waitForPlay(game);
      game.setCheats({ ...noCheats, noclip });
      game.key(true, keysByCode.KeyW);
      await play(game, 900);
      const { x } = game.status();
      game.stop();
      return x;
    };
    expect(await distance(false)).toBeLessThan(384);
    expect(await distance(true)).toBeGreaterThan(400);
  }, 30_000);
});
