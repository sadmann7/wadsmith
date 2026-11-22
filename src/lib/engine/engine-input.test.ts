import { afterEach, describe, expect, it } from "vitest";

import { addThing, setRoomDoor } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";
import { keysByCode } from "./runtime";
import {
  doorIndex,
  holdKey,
  launch,
  openMap,
  play,
  playerAt,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";

afterEach(stopGames);

// Fixed-point rounding can nudge the other axis by a map unit.
function moveDirection(moved: number) {
  return Math.abs(moved) < 8 ? 0 : Math.sign(moved);
}

describe.skipIf(!ready)("controls in the engine", () => {
  it("turns the player with the mouse", async () => {
    const game = await launch(openMap);
    await waitForPlay(game);
    const { angle, x, y } = game.status();
    for (let step = 0; step < 20; step += 1) {
      game.turn(40);
      await play(game, 30);
    }
    await play(game, 200);
    const status = game.status();
    const turned = (angle - status.angle + 360) % 360;
    expect(turned).toBeGreaterThan(90);
    expect(turned).toBeLessThan(120);
    expect(status.x).toBe(x);
    expect(status.y).toBe(y);
  }, 30_000);

  it.each([
    ["KeyW", 1, 0],
    ["ArrowUp", 1, 0],
    ["KeyS", -1, 0],
    ["ArrowDown", -1, 0],
    ["KeyA", 0, 1],
    ["KeyD", 0, -1],
  ])(
    "moves the player with %s",
    async (code, forward, side) => {
      const game = await launch(playerAt(openMap, 192, 160, 0));
      await waitForPlay(game);
      const before = game.status();
      await holdKey(game, code);
      const after = game.status();

      expect(moveDirection(after.x - before.x)).toBe(forward);
      expect(moveDirection(after.y - before.y)).toBe(side);
    },
    20_000,
  );

  it.each([
    ["ArrowLeft", 1],
    ["ArrowRight", -1],
  ])(
    "turns the player with %s",
    async (code, direction) => {
      const game = await launch(openMap);
      await waitForPlay(game);
      await holdKey(game, code);
      const turned = ((game.status().angle + 180) % 360) - 180;
      expect(Math.sign(turned)).toBe(direction);
    },
    20_000,
  );

  it.each(["ShiftLeft", "ShiftRight"])(
    "runs with %s",
    async (code) => {
      const distance = async (run: boolean) => {
        const game = await launch(playerAt(openMap, 192, 160, 0));
        await waitForPlay(game);
        const { x } = game.status();
        if (run) game.key(true, keysByCode[code]);
        game.key(true, keysByCode.KeyW);
        await play(game, 350);
        const moved = game.status().x - x;
        game.stop();
        return moved;
      };
      expect(await distance(true)).toBeGreaterThan(
        (await distance(false)) * 1.5,
      );
    },
    30_000,
  );

  it.each(["Space", "ControlLeft", "ControlRight"])(
    "fires with %s",
    async (code) => {
      const game = await launch(openMap);
      await waitForPlay(game);
      await holdKey(game, code);
      expect(game.status().ammo).toBeLessThan(50);
    },
    20_000,
  );

  it("uses a door with KeyE", async () => {
    const door = testMap.sectors[doorIndex].door!;
    const map = playerAt(
      setRoomDoor(testMap, "sector-4", { ...door, opensBy: "use" }),
      450,
      160,
      0,
    );
    const game = await launch({ ...map, switches: [] });
    await waitForPlay(game);
    await holdKey(game, "KeyE", 150);
    await play(game, 2000, () => game.sectorCeiling(doorIndex) === 92);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 20_000);

  it("opens the automap with Tab", async () => {
    const game = await launch(openMap);
    await waitForPlay(game);
    const darkShare = () => {
      const pixels = game.frame();
      let dark = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 12) {
          dark += 1;
        }
      }
      return dark / (pixels.length / 4);
    };
    expect(darkShare()).toBeLessThan(0.5);
    await holdKey(game, "Tab", 80);
    expect(darkShare()).toBeGreaterThan(0.5);
  }, 20_000);

  it("selects weapons with the number keys", async () => {
    const armed = ["shotgun", "chaingun"].reduce(
      (map, kind, index) =>
        addThing(map, kind as "shotgun", { x: 224 + index * 32, y: 160 }).map,
      playerAt(openMap, 192, 160, 0),
    );
    const game = await launch(armed);
    await waitForPlay(game);
    game.key(true, keysByCode.KeyW);
    await play(game, 900);
    game.key(false, keysByCode.KeyW);
    const select = async (code: string, ammoType: number) => {
      await holdKey(game, code, 80);
      await play(game, 2500, () => game.status().ammoType === ammoType);
      expect(game.status().ammoType).toBe(ammoType);
    };
    const noAmmo = 5;
    await select("Digit1", noAmmo);
    await select("Digit2", 0);
    await select("Digit3", 1);
    await select("Digit1", noAmmo);
    await select("Digit4", 0);
  }, 30_000);
});
