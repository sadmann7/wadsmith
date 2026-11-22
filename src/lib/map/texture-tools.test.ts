import { describe, expect, it } from "vitest";

import type { GameMap } from "./types";

import { addRoom, updateLineSide, updateSector } from "./edit";
import { wallKey } from "./geometry";
import { testMap } from "./test-map";
import { alignWalls, countTexture, replaceTexture } from "./texture-tools";

const empty: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

// A room 96 wide and 40 tall, so its walls are no whole number of textures.
const room = addRoom(
  empty,
  [
    { x: 0, y: 0 },
    { x: 96, y: 0 },
    { x: 96, y: 40 },
    { x: 0, y: 40 },
  ],
  {},
  8,
);
const [top, right, bottom, left] = [
  wallKey("v1", "v2"),
  wallKey("v2", "v3"),
  wallKey("v3", "v4"),
  wallKey("v4", "v1"),
];
const offsetOf = (map: GameMap, wall: string) =>
  map.lines?.[wall]?.sides?.[room.id]?.offsetX ?? 0;
const width = () => 64;

describe("aligning textures along walls", () => {
  it("starts each wall where the one before it ended, round the room", () => {
    const aligned = alignWalls(room.map, room.id, top, width);
    const offsets = [top, right, bottom, left].map((wall) =>
      offsetOf(aligned, wall),
    );
    // The room is read with itself on the right, which here runs top, right,
    // bottom, left: 96, 40 and 96 units on, wrapped at the texture's width.
    expect(offsets).toEqual([0, 32, 8, 40]);
  });

  it("keeps the offset of the wall it starts from", () => {
    const shifted = updateLineSide(room.map, top, room.id, { offsetX: 10 });
    const aligned = alignWalls(shifted, room.id, top, width);
    expect(
      [top, right, bottom, left].map((wall) => offsetOf(aligned, wall)),
    ).toEqual([10, 42, 18, 50]);
  });

  it("stops at a wall that shows another texture", () => {
    const painted = updateSector(room.map, room.id, {
      wallOverrides: { [bottom]: "BRICK1" },
    });
    const aligned = alignWalls(painted, room.id, top, width);
    expect(offsetOf(aligned, bottom)).toBe(0);
    expect(aligned.lines?.[bottom]).toBeUndefined();
    // The wall after the start runs on from it, and the one before it ends
    // where the start begins.
    expect([right, left].map((wall) => offsetOf(aligned, wall))).toEqual([
      32, 24,
    ]);
  });

  it("changes nothing for a room or wall that isn't there", () => {
    expect(alignWalls(room.map, "nowhere", top, width)).toBe(room.map);
    expect(alignWalls(room.map, room.id, "v8|v9", width)).toBe(room.map);
  });
});

describe("finding and replacing textures", () => {
  it("replaces a wall texture wherever a room or a side shows it", () => {
    const shared = wallKey("v3", "v4");
    const map = updateLineSide(
      updateSector(testMap, "sector-2", {
        wallOverrides: { [wallKey("v3", "v13")]: "STARTAN3" },
      }),
      shared,
      "sector-2",
      { upper: "STARTAN3", lower: "METAL" },
    );
    expect(countTexture(map, "STARTAN3", "wall")).toBe(3);
    const replaced = replaceTexture(map, "STARTAN3", "BRICK1", "wall");
    expect(replaced.count).toBe(3);
    expect(replaced.map.sectors[0].wallTexture).toBe("BRICK1");
    expect(replaced.map.sectors[1].wallOverrides).toEqual({
      [wallKey("v3", "v13")]: "BRICK1",
    });
    expect(replaced.map.lines?.[shared]?.sides?.["sector-2"]).toEqual({
      upper: "BRICK1",
      lower: "METAL",
    });
    expect(countTexture(replaced.map, "STARTAN3", "wall")).toBe(0);
  });

  it("replaces a flat on floors and ceilings and leaves walls alone", () => {
    const replaced = replaceTexture(testMap, "FLAT5_4", "FLOOR0_1", "flat");
    expect(replaced.count).toBe(2);
    expect(
      replaced.map.sectors
        .filter((sector) => sector.floorTexture === "FLOOR0_1")
        .map((sector) => sector.id),
    ).toEqual(["sector-2", "sector-4"]);
    expect(replaceTexture(testMap, "NOPE", "FLOOR0_1", "flat").map).toBe(
      testMap,
    );
    expect(replaceTexture(testMap, "NOPE", "BRICK1", "wall").map).toBe(testMap);
  });
});
