import { describe, expect, it } from "vitest";

import type { GameMap } from "./types";

import { addRoom, updateLineSide, updateSector } from "./edit";
import { wallKey } from "./geometry";
import { islandMap, testMap } from "./test-map";
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

  it("leaves a switch's and a door's art alone and carries on past them", () => {
    const first = wallKey("v1", "v15");
    const aligned = alignWalls(testMap, "sector-1", first, () => 128);
    const side = (wall: string, sector = "sector-1") =>
      aligned.lines?.[wall]?.sides?.[sector]?.offsetX ?? 0;
    // The switch sits on v15 to v16, 64 long, between two stretches of wall.
    expect(side(wallKey("v15", "v16"))).toBe(0);
    const before = side(first);
    const after = side(wallKey("v16", "v2"));
    expect(before).toBe(0);
    expect(after).toBe((160 + 64) % 128);
    // The corridor's wall into the arena door wears the door's face.
    const corridor = alignWalls(
      testMap,
      "sector-2",
      wallKey("v3", "v13"),
      () => 64,
    );
    expect(
      corridor.lines?.[wallKey("v13", "v14")]?.sides?.["sector-2"],
    ).toBeUndefined();
    // A door's own tracks stay put.
    expect(
      alignWalls(testMap, "sector-4", wallKey("v13", "v7"), () => 64),
    ).toBe(testMap);
  });

  it("aligns the walls a room shows around a room drawn inside it", () => {
    const riser = wallKey("e", "f");
    const shifted = updateLineSide(islandMap, riser, "yard", { offsetX: 16 });
    const aligned = alignWalls(shifted, "yard", riser, () => 64);
    expect(aligned).not.toBe(shifted);
    const offsets = ["e|f", "f|g", "g|h", "e|h"].map(
      (wall) => aligned.lines?.[wall]?.sides?.yard?.offsetX ?? 0,
    );
    // The stage is 128 a side, so every wall round it starts 16 in.
    expect(offsets).toEqual([16, 16, 16, 16]);
    expect(aligned.lines?.[riser]?.sides?.stage).toBeUndefined();
  });

  it("doesn't wrap at a guess while a texture's width isn't known", () => {
    const aligned = alignWalls(room.map, room.id, top, () => 1);
    expect(
      [top, right, bottom, left].map((wall) => offsetOf(aligned, wall)),
    ).toEqual([0, 96, 136, 232]);
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
