import { describe, expect, it } from "vitest";

import { compileMap } from "@/wad/compile";
import { maxDescriptionLength } from "@/episodes/episode-data";
import { deathmatchStarts, doorTextures, switchTextures } from "@/map/catalog";
import { checkMap } from "@/map/checks";
import { freedoomFlats, freedoomWalls } from "@/map/freedoom-textures";
import { validateMap } from "@/map/validate";
import { buildMap, rect } from "./build-map";
import { featuredMaps } from "./index";

const room = {
  floor: 0,
  ceiling: 128,
  light: 160,
  floorTexture: "FLOOR4_8",
  ceilingTexture: "CEIL3_5",
  wallTexture: "STARTAN3",
};

describe("map builder", () => {
  it("shares the corners of rooms that touch", () => {
    const map = buildMap({
      name: "Two rooms",
      rooms: [
        { name: "West", points: rect(0, 0, 128, 128), ...room },
        { name: "East", points: rect(128, 0, 128, 128), ...room },
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(Object.keys(map.vertices)).toHaveLength(6);
    expect(validateMap(map)).toEqual([]);
  });

  it("splits a wall where a smaller room meets it", () => {
    const map = buildMap({
      name: "Hall and alcove",
      rooms: [
        { name: "Hall", points: rect(0, 0, 256, 128), ...room },
        { name: "Alcove", points: rect(96, 128, 64, 64), ...room },
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(map.sectors[0].vertices).toHaveLength(6);
    expect(validateMap(map)).toEqual([]);
  });

  it("scales a plan drawn in grid units", () => {
    const map = buildMap({
      name: "Scaled",
      scale: 4,
      rooms: [{ name: "Room", points: rect(0, 0, 32, 32), ...room }],
      things: [{ kind: "player", at: [16, 16] }],
    });
    expect(map.vertices.v3).toEqual({ x: 128, y: 128 });
    expect(map.things[0]).toMatchObject({ x: 64, y: 64 });
  });

  it("refuses a switch on a room that isn't there", () => {
    expect(() =>
      buildMap({
        name: "Broken",
        rooms: [{ name: "Room", points: rect(0, 0, 128, 128), ...room }],
        things: [],
        switches: [
          {
            room: "Elsewhere",
            wall: [
              [0, 0],
              [128, 0],
            ],
            texture: "SW1STRTN",
          },
        ],
      }),
    ).toThrow("no room named Elsewhere");
  });
});

describe.each(featuredMaps)("$title", ({ map, slot, players, mode }) => {
  it("is ready to play with no warnings", () => {
    expect(validateMap(map)).toEqual([]);
    expect(checkMap(map)).toEqual([]);
    expect(compileMap(map).length).toBeGreaterThan(0);
  });

  it("has a start for every player", () => {
    const deathmatch = map.things.filter(
      (thing) => thing.kind === "deathmatch-start",
    );
    const starts = ["player", "player-2", "player-3", "player-4"];
    for (const [index, kind] of starts.entries()) {
      const placed = map.things.some((thing) => thing.kind === kind);
      expect(placed).toBe(index < (mode === "deathmatch" ? 1 : players.max));
    }
    expect(deathmatch.length >= deathmatchStarts).toBe(mode === "deathmatch");
    expect(mode === "single").toBe(players.max === 1);
  });

  it("ends the way its mode does", () => {
    const exits = Object.values(map.lines ?? {}).filter(
      (line) => line.action?.kind === "exit",
    );
    expect(exits).toHaveLength(mode === "deathmatch" ? 0 : 1);
    expect(slot).toMatch(/^MAP0\d$/);
  });

  it("uses only textures the engine has", () => {
    const flats = new Set<string>(freedoomFlats);
    const walls = new Set<string>([
      ...freedoomWalls,
      ...doorTextures,
      ...switchTextures,
    ]);
    for (const sector of map.sectors) {
      expect(flats.has(sector.floorTexture), sector.floorTexture).toBe(true);
      expect(flats.has(sector.ceilingTexture), sector.ceilingTexture).toBe(
        true,
      );
      expect(walls.has(sector.wallTexture), sector.wallTexture).toBe(true);
      if (sector.door) expect(walls.has(sector.door.texture)).toBe(true);
    }
    for (const item of map.switches) {
      expect(walls.has(item.texture), item.texture).toBe(true);
    }
  });
});

it("gives every featured map its own slot", () => {
  const slots = featuredMaps.map((entry) => entry.slot);
  expect(new Set(slots).size).toBe(slots.length);
});

it("keeps blurbs short enough to be a map's description", () => {
  for (const entry of featuredMaps) {
    expect(entry.blurb.length).toBeLessThanOrEqual(maxDescriptionLength);
  }
});
