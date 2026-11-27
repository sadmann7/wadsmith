import { afterEach, describe, expect, it } from "vitest";

import type { GameMap, LineAction } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { thingCatalog } from "@/lib/map/catalog";
import {
  addThing,
  setLineTarget,
  setRoomDoor,
  updateLine,
  updateSector,
} from "@/lib/map/edit";
import { starterMap } from "@/lib/map/starter-map";
import { testMap } from "@/lib/map/test-map";

import { type DoomGame, doomKeys, keysByCode } from "./runtime";
import {
  doorFloor,
  doorIndex,
  launch,
  play,
  playerAt,
  pressUse,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";
import { RunRecorder } from "./trail";

afterEach(stopGames);

describe.skipIf(!ready)("doors and line actions in the engine", () => {
  it("opens a door from a connected switch", async () => {
    const game = await launch(playerAt(testMap, 192, 40, 90));
    await waitForPlay(game);
    expect(game.sectorCeiling(doorIndex)).toBe(doorFloor);
    await pressUse(game);
    await play(game, 2000);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 30_000);

  it("ignores the use key on a switch-only door", async () => {
    const game = await launch(playerAt(testMap, 450, 160, 0));
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 800);
    expect(game.sectorCeiling(doorIndex)).toBe(doorFloor);
  }, 30_000);

  it("opens a use door and closes it again", async () => {
    const door = defined(testMap.sectors[doorIndex].door);
    const map = playerAt(
      setRoomDoor(testMap, "sector-4", {
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

  it("opens a secret door dressed as the corridor's wall", async () => {
    const map = playerAt(
      setRoomDoor(testMap, "sector-4", {
        opensBy: "use",
        closes: false,
        texture: testMap.sectors[1].wallTexture,
      }),
      450,
      160,
      0,
    );
    const game = await launch({ ...map, switches: [] });
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 2000);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 30_000);

  it("lets the player shoot a monster through an opened door", async () => {
    const door = defined(testMap.sectors[doorIndex].door);
    const map = playerAt(
      setRoomDoor(testMap, "sector-4", { ...door, opensBy: "use" }),
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

  it("runs a walk-over line on the sector it targets", async () => {
    const map = playerAt(withDoorAction("v3|v4", "walk"), 340, 160, 0);
    const game = await launch(
      updateSector(map, "sector-1", { effect: "glow" }),
    );
    await waitForPlay(game);
    expect(game.sectorCeiling(doorIndex)).toBe(doorFloor);
    game.key(true, doomKeys.up);
    await play(game, 3000, () => game.status().x > 400);
    game.key(false, doomKeys.up);
    await play(game, 4000, () => game.sectorCeiling(doorIndex) === 92);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 30_000);

  it("teleports a player who crosses the line from its front", async () => {
    const teleporter = (front: string) =>
      playerAt(
        updateLine(
          setLineTarget(
            updateLine(
              addThing(testMap, "teleport-destination", { x: 864, y: 32 }).map,
              "v3|v4",
              {
                action: {
                  kind: "teleport",
                  trigger: "walk",
                  repeat: true,
                  tag: 0,
                },
              },
            ),
            "v3|v4",
            "sector-3",
          ),
          "v3|v4",
          { front },
        ),
        340,
        160,
        0,
      );
    const across = async (map: GameMap) => {
      const game = await launch(map);
      await waitForPlay(game);
      game.key(true, doomKeys.up);
      await play(game, 3000, () => game.status().x > 420);
      game.key(false, doomKeys.up);
      const { x, y } = game.status();
      game.stop();
      return { x, y };
    };
    expect(await across(teleporter("sector-1"))).toMatchObject({
      x: 864,
      y: -32,
    });
    expect((await across(teleporter("sector-2"))).x).toBeLessThan(512);
  }, 30_000);

  it("runs a press-switch line on a solid wall", async () => {
    const map = playerAt(withDoorAction("v1|v15", "switch"), 80, 40, 90);
    const game = await launch(map);
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 4000, () => game.sectorCeiling(doorIndex) === 92);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 30_000);

  it("opens a locked door only after the key is picked up", async () => {
    const wall = "v13|v14";
    const locked = playerAt(
      updateLine(testMap, wall, {
        action: {
          kind: "door-open",
          trigger: "door",
          repeat: false,
          key: "red",
          tag: 0,
        },
      }),
      430,
      160,
      0,
    );
    const noKey = await launch(locked);
    await waitForPlay(noKey);
    noKey.key(true, doomKeys.up);
    await play(noKey, 800);
    noKey.key(false, doomKeys.up);
    await pressUse(noKey);
    await play(noKey, 1000);
    expect(noKey.sectorCeiling(doorIndex)).toBe(doorFloor);
    noKey.stop();

    const game = await launch(
      addThing(locked, "red-key", { x: 456, y: 160 }).map,
    );
    await waitForPlay(game);
    game.key(true, doomKeys.up);
    await play(game, 800);
    game.key(false, doomKeys.up);
    await pressUse(game);
    await play(game, 4000, () => game.sectorCeiling(doorIndex) === 92);
    expect(game.sectorCeiling(doorIndex)).toBe(92);
  }, 40_000);
});

function withDoorAction(wall: string, trigger: LineAction["trigger"]) {
  return setLineTarget(
    updateLine(testMap, wall, {
      action: { kind: "door-open", trigger, repeat: false, tag: 0 },
    }),
    wall,
    "sector-4",
  );
}

describe.skipIf(!ready)("starter map in the engine", () => {
  const quiet: GameMap = {
    ...starterMap,
    things: starterMap.things.filter(
      (thing) => thingCatalog[thing.kind].category !== "enemy",
    ),
  };
  const room = (name: string) =>
    starterMap.sectors.findIndex((sector) => sector.name === name);
  const blueKey = 1;

  async function walk(game: DoomGame, code: string, done: () => boolean) {
    const key = keysByCode[code];
    game.key(true, key);
    await play(game, 8000, done);
    game.key(false, key);
  }

  it("opens the first door by walking up to it and pressing use", async () => {
    const game = await launch(quiet);
    await waitForPlay(game);
    const door = room("First door");
    const closed = game.sectorCeiling(door);
    await walk(game, "KeyW", () => game.status().x > 220);
    await pressUse(game);
    await play(game, 2000, () => game.sectorCeiling(door) > closed + 64);
    await walk(game, "KeyW", () => game.status().x > 320);
    expect(game.status().x).toBeGreaterThan(320);
  }, 40_000);

  it("opens the blue door only with the key from the pedestal", async () => {
    const door = room("Blue door");
    const shut = await launch(playerAt(quiet, 936, 128, 0));
    await waitForPlay(shut);
    const closed = shut.sectorCeiling(door);
    await pressUse(shut);
    await play(shut, 1500);
    expect(shut.sectorCeiling(door)).toBe(closed);
    shut.stop();

    const game = await launch(playerAt(quiet, 720, 152, 0));
    await waitForPlay(game);
    await walk(game, "KeyW", () => game.status().x > 936);
    expect(game.status().keys & blueKey).toBe(blueKey);
    await pressUse(game);
    await play(game, 2000, () => game.sectorCeiling(door) > closed + 64);
    await walk(game, "KeyW", () => game.status().x > 1024);
    expect(game.status().x).toBeGreaterThan(1024);
  }, 40_000);

  it("rides the lift up to the ledge", async () => {
    const game = await launch(playerAt(quiet, 1148, 64, 0));
    await waitForPlay(game);
    const lift = room("Lift");
    const raised = game.sectorFloor(lift);
    await pressUse(game);
    await play(game, 1200);
    expect(game.sectorFloor(lift)).toBeLessThan(raised);
    await walk(game, "KeyW", () => game.status().x > 1212);
    await play(game, 4500);
    await walk(game, "KeyA", () => game.status().y > 0);
    expect(game.status().y).toBeGreaterThan(0);
  }, 40_000);

  it("opens the odd wall on the ledge into the secret", async () => {
    const game = await launch(playerAt(quiet, 1088, -64, 90));
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 1500);
    await walk(
      game,
      "KeyW",
      () => game.status().armor > 0 && game.status().secrets > 0,
    );
    expect(game.status().armor).toBeGreaterThan(0);
    expect(game.status().secrets).toBe(1);
  }, 40_000);

  it("opens the exit door and ends at the exit switch", async () => {
    const game = await launch(playerAt(quiet, 1208, -32, 0));
    await waitForPlay(game);
    const door = room("Exit door");
    const closed = game.sectorCeiling(door);
    await pressUse(game);
    await play(game, 2000, () => game.sectorCeiling(door) > closed + 56);
    await walk(game, "KeyW", () => game.status().x > 1384);
    await pressUse(game);
    await play(game, 3000, () => !game.status().inLevel);
    expect(game.status().inLevel).toBe(false);
    // The trail ends with how the level stood at the exit.
    const recorder = new RunRecorder();
    const trail = game.takeTrail();
    if (trail) recorder.add(trail);
    const result = recorder.run()?.result;
    expect(result?.tics).toBeGreaterThan(35);
    expect(result).toMatchObject({ kills: 0, totalKills: 0 });
    expect(result?.totalSecrets).toBe(game.status().totalSecrets);
  }, 40_000);
});
