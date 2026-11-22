import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { compileMap } from "@/lib/wad/compile";
import { buildTextureWad, type IndexedImage } from "@/lib/wad/resources";

import { screenSize } from "./runtime";
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

const iwadPath = resolve(
  import.meta.dirname,
  "../../../public/engine/freedoom2.wad",
);

describe.skipIf(!ready)("custom textures in the engine", () => {
  it("draws a wall made from an image, in the image's color", async () => {
    const iwad = new Uint8Array(readFileSync(iwadPath));
    const seen: number[] = [];
    for (const color of [176, 200]) {
      const pack = buildTextureWad([
        { name: "MYBRICK", image: solid(64, 128, color) },
        { name: "MYFLOOR", image: solid(64, 64, color) },
      ]);
      engineWarnings.length = 0;
      const game = await launch(
        compileMap(brickRoom, "MAP01", {}, { iwad, resources: [pack] }),
      );
      await waitForPlay(game);
      await play(game, 300);
      expect(game.status().inLevel).toBe(true);
      expect(
        engineWarnings.filter((line) => /MYBRICK|MYFLOOR/.test(line)),
      ).toEqual([]);
      seen.push(wallPixel(game.frame()));
      stopGames();
    }
    // The wall fills the view, so a different image shows a different color.
    expect(seen[0]).not.toBe(seen[1]);
  }, 60_000);

  // The engine stops on an animation whose first frame is numbered after its
  // last, which a lone frame in a WAD would be.
  it("plays a map whose resource repaints one frame of an animated floor", async () => {
    const iwad = new Uint8Array(readFileSync(iwadPath));
    const pack = buildTextureWad([
      { name: "NUKAGE1", image: solid(64, 64, 200) },
    ]);
    const game = await launch(
      compileMap(
        roomWith({ floorTexture: "NUKAGE1" }),
        "MAP01",
        {},
        { iwad, resources: [pack] },
      ),
    );
    await waitForPlay(game);
    await play(game, 300);
    expect(game.status().inLevel).toBe(true);
  }, 60_000);
});

const brickRoom = roomWith({
  wallTexture: "MYBRICK",
  floorTexture: "MYFLOOR",
});

const screen = { resolution: "classic", widescreen: false } as const;

// A spot left of the weapon and above the horizon, which only the wall covers.
function wallPixel(frame: Uint8ClampedArray) {
  const { width, height } = screenSize(screen);
  const at = (Math.floor(height * 0.3) * width + Math.floor(width * 0.25)) * 4;
  return (frame[at] << 16) | (frame[at + 1] << 8) | frame[at + 2];
}

function solid(width: number, height: number, color: number): IndexedImage {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height).fill(color),
    opaque: new Uint8Array(width * height).fill(1),
  };
}

// The player faces the start room's west wall from close by, in full light.
function roomWith(change: Partial<GameMap["sectors"][number]>): GameMap {
  const map = playerAt(openMap, 96, 160, 180);
  return {
    ...map,
    sectors: map.sectors.map((sector, index) =>
      index === 0 ? { ...sector, light: 255, ...change } : sector,
    ),
  };
}
