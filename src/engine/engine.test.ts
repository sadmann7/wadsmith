import { afterEach, describe, expect, it } from "vitest";

import { thingKinds } from "@/map/catalog";
import { addThing, updateSector } from "@/map/edit";
import { starterMap } from "@/map/starter-map";
import { compileMap } from "@/wad/compile";
import { doomKeys, screenSize, type Screen } from "./runtime";
import {
  engineWarnings,
  launch,
  openMap,
  play,
  playerAt,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";

afterEach(stopGames);

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

  it.each<Screen>([
    { resolution: "high", widescreen: false },
    { resolution: "classic", widescreen: true },
    { resolution: "high", widescreen: true },
  ])(
    "draws the level on a $resolution screen, widescreen $widescreen",
    async (screen) => {
      const game = await launch(openMap, null, undefined, screen);
      await waitForPlay(game);
      const { width, height } = screenSize(screen);
      const pixels = game.frame();
      expect(pixels.length).toBe(width * height * 4);
      const colors = new Set<number>();
      for (let index = 0; index < pixels.length; index += 4) {
        colors.add(
          (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2],
        );
      }
      expect(colors.size).toBeGreaterThan(16);
    },
    30_000,
  );

  it("reports a map the engine refuses", async () => {
    await expect(launch({ ...openMap, things: [] })).rejects.toBeDefined();
  }, 30_000);

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

describe.skipIf(!ready)("a loaded WAD in the engine", () => {
  it("loads several WADs and a patch at the level it asks for", async () => {
    const game = await launch({
      wads: [compileMap(starterMap), compileMap(starterMap, "MAP02")],
      dehacked: [
        new TextEncoder().encode(
          "Patch File for DeHackEd v3.0\nDoom version = 21\nPatch format = 6\n",
        ),
      ],
      complevel: "boom",
      warp: 2,
    });
    await waitForPlay(game);
    expect(game.status().map).toBe(2);
    expect(game.classicMode()).toEqual({ strict: true, demoVersion: 202 });
  }, 30_000);
});
