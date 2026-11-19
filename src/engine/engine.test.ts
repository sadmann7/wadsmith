import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { thingCatalog, thingKinds } from "../map/catalog";
import {
  addThing,
  setLineTarget,
  setRoomDoor,
  updateLine,
  updateSector,
  updateThing,
} from "../map/edit";
import { featuredMaps } from "../map/featured";
import { pointInPolygon, wallKey, wallOwners } from "../map/geometry";
import { starterMap } from "../map/starter-map";
import { testMap } from "../map/test-map";
import type { GameMap, LineAction } from "../map/types";
import { compileEpisode, compileMap } from "../wad/compile";
import {
  doomKeys,
  keysByCode,
  screenSizes,
  startDoom,
  type CreateDoom,
  type DoomGame,
  type GameEvents,
  type Resolution,
} from "./runtime";

const engineDirectory = resolve(import.meta.dirname, "../../public/engine");
const ready = existsSync(resolve(engineDirectory, "woof.js"));

const running: DoomGame[] = [];

afterEach(() => {
  for (const game of running.splice(0)) game.stop();
});

const engineWarnings: string[] = [];

async function launch(
  map: GameMap | Uint8Array,
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
    map: map instanceof Uint8Array ? map : compileMap(map),
    options: { print: () => {}, printErr: (line) => engineWarnings.push(line) },
    events,
    sampleRate,
    resolution,
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
  ...setRoomDoor(testMap, "sector-4", undefined),
  switches: [],
};
const doorIndex = testMap.sectors.findIndex((sector) => sector.door);
const doorFloor = testMap.sectors[doorIndex].floor;

function playerAt(map: GameMap, x: number, y: number, angle: number) {
  return updateThing(map, "player-1", { x, y, angle });
}

function withDoorAction(wall: string, trigger: LineAction["trigger"]) {
  return setLineTarget(
    updateLine(testMap, wall, {
      action: { kind: "door-open", trigger, repeat: false, tag: 0 },
    }),
    wall,
    "sector-4",
  );
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

async function holdKey(game: DoomGame, code: string, ms = 400) {
  const key = keysByCode[code];
  game.key(true, key);
  await play(game, ms);
  game.key(false, key);
  await play(game, 500);
}

// Fixed-point rounding can nudge the other axis by a map unit.
function moveDirection(moved: number) {
  return Math.abs(moved) < 8 ? 0 : Math.sign(moved);
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

  it("draws the level at double resolution", async () => {
    const game = await launch(openMap, null, undefined, "high");
    await waitForPlay(game);
    const { width, height } = screenSizes.high;
    const pixels = game.frame();
    expect(pixels.length).toBe(width * height * 4);
    const colors = new Set<number>();
    for (let index = 0; index < pixels.length; index += 4) {
      colors.add(
        (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2],
      );
    }
    expect(colors.size).toBeGreaterThan(16);
  }, 30_000);

  it("reports a map the engine refuses", async () => {
    await expect(launch({ ...openMap, things: [] })).rejects.toBeDefined();
  }, 30_000);

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
    const door = testMap.sectors[doorIndex].door!;
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

  it("lets the player shoot a monster through an opened door", async () => {
    const door = testMap.sectors[doorIndex].door!;
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

  it("loads every thing type and honors difficulty", async () => {
    const everything = thingKinds
      .filter((kind) => kind !== "player")
      .reduce(
        (map, kind, index) =>
          addThing(map, kind, {
            x: 560 + (index % 6) * 64,
            y: 0 + Math.floor(index / 6) * 64,
          }).map,
        openMap,
      );
    const hardOnly = everything.things.map((thing) =>
      thing.id === "imp-1" ? { ...thing, skills: ["hard" as const] } : thing,
    );
    const all = await launch(everything);
    await waitForPlay(all);
    const total = all.status().totalKills;
    expect(all.status().inLevel).toBe(true);
    all.stop();
    const fewer = await launch({ ...everything, things: hardOnly });
    await waitForPlay(fewer);
    expect(fewer.status().totalKills).toBe(total - 1);
  }, 40_000);

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

  it.each([60, 75, 90, 120, 144, 165, 240, 360])(
    "paces frames and game time on a %i Hz display",
    async (hertz) => {
      let frames = 0;
      const game = await launch(openMap, null, {
        onFrame: () => {
          frames += 1;
        },
      });
      await waitForPlay(game);
      frames = 0;
      const startTic = game.gameTic();
      const start = performance.now();
      let refresh = start;
      while (performance.now() - start < 2000) {
        refresh += 1000 / hertz;
        game.syncToDisplay();
        await play(game, Math.max(0, refresh - performance.now()));
      }
      const seconds = (performance.now() - start) / 1000;
      expect(frames / seconds).toBeGreaterThan(50);
      expect(frames / seconds).toBeLessThan(62);
      expect((game.gameTic() - startTic) / seconds).toBeGreaterThan(33);
      expect((game.gameTic() - startTic) / seconds).toBeLessThan(37);
    },
    20_000,
  );

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

  it("plays with classic Doom rules and rendering", async () => {
    engineWarnings.length = 0;
    const game = await launch(openMap);
    await waitForPlay(game);
    expect(engineWarnings.join("\n")).not.toContain("Unknown config key");
    expect(game.classicMode()).toEqual({ strict: true, demoVersion: 109 });
    for (const [name, value] of Object.entries({
      translucency: 0,
      fuzzmode: 0,
      flipcorpses: 0,
      colored_blood: 0,
      voxels_rendering: 0,
      invul_mode: 0,
      extra_level_brightness: 0,
      flashing_hom: 0,
      weapon_recoil: 0,
      weapon_recoilpitch: 0,
      center_weapon: 0,
      weapon_bobbing_pct: 4,
      view_bobbing_pct: 4,
      autorun: 0,
      autostrafe50: 0,
      freelook: 0,
      novert: 1,
      hud_crosshair: 0,
      hud_secret_message: 0,
      show_obituary_messages: 0,
      weapon_carousel: 0,
      pitched_sounds: 0,
      snd_channels: 8,
      emu_missedbackside: 0,
    })) {
      expect([name, game.setting(name)]).toEqual([name, value]);
    }
  }, 20_000);

  it("keeps game time at 35 tics a second", async () => {
    const game = await launch(openMap);
    await waitForPlay(game);
    const startTic = game.gameTic();
    const start = performance.now();
    await play(game, 2000);
    const rate =
      (game.gameTic() - startTic) / ((performance.now() - start) / 1000);
    expect(rate).toBeGreaterThan(33);
    expect(rate).toBeLessThan(37);
  }, 30_000);

  it("keeps combined sound below full scale", async () => {
    const game = await launch(openMap, 48_000);
    await waitForPlay(game);
    game.setSound(15, false);
    game.key(true, doomKeys.fire);
    let peak = 0;
    for (let block = 0; block < 400; block += 1) {
      for (const channel of game.audio(512)) {
        for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
      }
      await play(game, 5);
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1);
  }, 30_000);

  it("reports the run for the playtest HUD", async () => {
    const map = playerAt(openMap, 96, 160, 90);
    const withPickups = addThing(
      addThing(map, "red-key", { x: 96, y: 128 }).map,
      "medikit",
      { x: 300, y: 300 },
    ).map;
    const secret = updateSector(withPickups, "sector-3", { effect: "secret" });
    const game = await launch(secret);
    await waitForPlay(game);
    const start = game.status();
    expect(start).toMatchObject({
      angle: 90,
      armor: 0,
      ammo: 50,
      ammoType: 0,
      keys: 0,
      totalItems: 0,
      totalSecrets: 1,
    });
    game.key(true, doomKeys.up);
    await play(game, 3000, () => game.status().keys !== 0);
    game.key(false, doomKeys.up);
    expect(game.status().keys & 4).toBe(4);
    expect(game.status().tics).toBeGreaterThan(start.tics);
  }, 30_000);
});

describe.skipIf(!ready)("starter map in the engine", () => {
  const quiet: GameMap = {
    ...starterMap,
    things: starterMap.things.filter(
      (thing) => thingCatalog[thing.kind].category !== "enemy",
    ),
  };
  const blueDoor = starterMap.sectors.findIndex(
    (sector) => sector.name === "Blue door",
  );
  const blueKey = 1;

  async function walk(game: DoomGame, code: string, done: () => boolean) {
    const key = keysByCode[code];
    game.key(true, key);
    await play(game, 8000, done);
    game.key(false, key);
  }

  it("rides the lift up to the blue key", async () => {
    const game = await launch(playerAt(quiet, 736, 80, 90));
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 1200);
    await walk(game, "KeyW", () => game.status().y > 16);
    await play(game, 4500);
    await walk(game, "KeyD", () => (game.status().keys & blueKey) !== 0);
    expect(game.status().keys & blueKey).toBe(blueKey);
  }, 40_000);

  it("lowers the alcove into the secret room", async () => {
    const game = await launch(playerAt(quiet, 48, 176, 180));
    await waitForPlay(game);
    await pressUse(game);
    await play(game, 3500);
    await walk(game, "KeyW", () => game.status().armor > 0);
    expect(game.status().armor).toBeGreaterThan(0);
    expect(game.status().secrets).toBe(1);
  }, 40_000);

  it("opens the blue door only with the key, and ends at the exit", async () => {
    const shut = await launch(playerAt(quiet, 920, 160, 0));
    await waitForPlay(shut);
    const closed = shut.sectorCeiling(blueDoor);
    await pressUse(shut);
    await play(shut, 1500);
    expect(shut.sectorCeiling(blueDoor)).toBe(closed);
    shut.stop();

    const game = await launch(
      updateThing(playerAt(quiet, 872, 160, 0), "blue-key-1", {
        x: 904,
        y: 160,
      }),
    );
    await waitForPlay(game);
    await walk(game, "KeyW", () => (game.status().keys & blueKey) !== 0);
    expect(game.status().keys & blueKey).toBe(blueKey);
    await walk(game, "KeyW", () => game.status().x > 920);
    await pressUse(game);
    await play(game, 2000, () => game.sectorCeiling(blueDoor) > closed + 64);
    await walk(game, "KeyW", () => game.status().x > 1136);
    await pressUse(game);
    await play(game, 3000, () => !game.status().inLevel);
    expect(game.status().inLevel).toBe(false);
  }, 40_000);
});

// Stands the player just in front of a wall, inside the given room, facing it.
function facingWall(map: GameMap, from: string, to: string, roomId: string) {
  const a = map.vertices[from];
  const b = map.vertices[to];
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const room = map.sectors.find((sector) => sector.id === roomId)!;
  const polygon = room.vertices.map((id) => map.vertices[id]);
  const inward = pointInPolygon(
    { x: middle.x + normal.x * 8, y: middle.y + normal.y * 8 },
    polygon,
  )
    ? 1
    : -1;
  const x = Math.round(middle.x + normal.x * inward * 36);
  const y = Math.round(middle.y + normal.y * inward * 36);
  // Doom angles turn counter-clockwise with y up, and editor y points down.
  const angle =
    Math.round((Math.atan2(y - middle.y, middle.x - x) * 180) / Math.PI + 360) %
    360;
  return playerAt(map, x, y, angle);
}

type Press = {
  label: string;
  map: GameMap;
  height: (game: DoomGame) => number;
  done: (game: DoomGame, before: number) => boolean;
};

function pressesOf(map: GameMap): Press[] {
  const presses: Press[] = [];
  const owners = wallOwners(map);
  const switchWalls = new Set(
    map.switches.map((item) => wallKey(item.from, item.to)),
  );
  for (const item of map.switches) {
    if (!item.door) continue;
    const door = map.sectors.findIndex((sector) => sector.id === item.door);
    presses.push({
      label: `switch opens ${map.sectors[door].name}`,
      map: facingWall(map, item.from, item.to, item.sector),
      height: (game) => game.sectorCeiling(door),
      done: (game, before) => game.sectorCeiling(door) > before + 56,
    });
  }
  for (const [wall, line] of Object.entries(map.lines ?? {})) {
    const action = line.action;
    if (action?.trigger !== "switch") continue;
    const [from, to] = wall.split("|");
    const target = map.sectors.findIndex((sector) => sector.tag === action.tag);
    const room = switchWalls.has(wall)
      ? map.switches.find((item) => wallKey(item.from, item.to) === wall)!
          .sector
      : owners.get(wall)!.find((sector) => sector.tag !== action.tag)!.id;
    const placed = facingWall(map, from, to, room);
    if (action.kind === "exit") {
      presses.push({
        label: "exit switch ends the level",
        map: placed,
        height: () => 0,
        done: (game) => !game.status().inLevel,
      });
    } else if (action.kind === "floor-raise-next") {
      presses.push({
        label: `switch raises ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) > before,
      });
    } else if (action.kind === "lift") {
      presses.push({
        label: `pressing ${wall} lowers ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) < before - 32,
      });
    } else if (action.kind === "floor-lower") {
      presses.push({
        label: `pressing lowers ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) < before - 56,
      });
    }
  }
  return presses;
}

describe.skipIf(!ready)("featured maps in the engine", () => {
  for (const featured of featuredMaps) {
    const quiet: GameMap = {
      ...featured.map,
      things: featured.map.things.filter(
        (thing) => thingCatalog[thing.kind].category !== "enemy",
      ),
    };
    for (const press of pressesOf(quiet)) {
      it(`${featured.title}: ${press.label}`, async () => {
        const game = await launch(press.map);
        await waitForPlay(game);
        const before = press.height(game);
        await pressUse(game);
        await play(game, 6000, () => press.done(game, before));
        expect(press.done(game, before)).toBe(true);
      }, 30_000);
    }
  }
});

describe.skipIf(!ready)("an episode in the engine", () => {
  it("moves on to the next map after the tally screen", async () => {
    const [first] = featuredMaps;
    const quiet: GameMap = {
      ...first.map,
      things: first.map.things.filter(
        (thing) => thingCatalog[thing.kind].category !== "enemy",
      ),
    };
    const exit = pressesOf(quiet).find((press) =>
      press.label.startsWith("exit"),
    )!;
    const game = await launch(
      compileEpisode([
        { slot: "MAP01", map: exit.map },
        { slot: "MAP02", map: starterMap },
      ]),
    );
    await waitForPlay(game);
    expect(game.status().map).toBe(1);
    await pressUse(game);
    await play(game, 6000, () => !game.status().inLevel);
    expect(game.status()).toMatchObject({ inLevel: false, map: 1 });
    await play(game, 8000, () => {
      if (game.status().inLevel) return true;
      game.key(game.gameTic() % 8 < 4, doomKeys.use);
      return false;
    });
    game.key(false, doomKeys.use);
    expect(game.status()).toMatchObject({ inLevel: true, map: 2 });
  }, 30_000);
});
