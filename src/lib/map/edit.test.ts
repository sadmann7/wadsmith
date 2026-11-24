import { describe, expect, it } from "vitest";

import type { GameMap, Point } from "./types";

import {
  addRoom,
  addRoomOnSide,
  applyPositions,
  defaultDoor,
  newRoomLooks,
  positionsOf,
  setRoomDoor,
  updateSector,
  wallNear,
} from "./edit";
import { testMap } from "./test-map";

const blank: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

describe("applyPositions", () => {
  it("keeps every thing and corner that didn't move", () => {
    const positions = positionsOf(testMap);
    const dropped = applyPositions(testMap, {
      ...positions,
      v1: { x: 8, y: 0 },
      "thing:imp-1": { x: 840, y: 64 },
    });
    expect(dropped.vertices.v1).toEqual({ x: 8, y: 0 });
    expect(dropped.vertices.v2).toBe(testMap.vertices.v2);
    expect(dropped.things[3]).toEqual({ ...testMap.things[3], x: 840 });
    expect(dropped.things.slice(0, 3)).toEqual(testMap.things.slice(0, 3));
    expect(dropped.things[0]).toBe(testMap.things[0]);
    expect(positionsOf(dropped)["thing:player-1"]).toBe(
      positions["thing:player-1"],
    );
  });
});

describe("positionsOf", () => {
  it("gives one map one positions object", () => {
    expect(positionsOf(testMap)).toBe(positionsOf(testMap));
    expect(positionsOf({ ...testMap })).not.toBe(positionsOf(testMap));
    expect(positionsOf({ ...testMap })).toEqual(positionsOf(testMap));
  });

  it("keeps a thing's point while the thing is unchanged", () => {
    const before = positionsOf(testMap);
    const raised = positionsOf(updateSector(testMap, "sector-1", { floor: 8 }));
    expect(raised["thing:imp-1"]).toBe(before["thing:imp-1"]);
    expect(raised.v1).toBe(before.v1);
    const moved = positionsOf({
      ...testMap,
      things: testMap.things.map((thing) =>
        thing.id === "imp-1" ? { ...thing, x: 840 } : thing,
      ),
    });
    expect(moved["thing:imp-1"]).toEqual({ x: 840, y: 64 });
    expect(moved["thing:zombieman-1"]).toBe(before["thing:zombieman-1"]);
  });
});

describe("wallNear", () => {
  it("finds a wall within reach and none farther", () => {
    expect(wallNear(testMap, { x: 80, y: 6 }, 14)).toEqual({
      sector: "sector-1",
      wall: "v1|v15",
    });
    expect(wallNear(testMap, { x: 80, y: 40 }, 14)).toBeNull();
  });

  it("gives a shared wall to the room under the pointer", () => {
    expect(wallNear(testMap, { x: 380, y: 160 }, 14)).toEqual({
      sector: "sector-1",
      wall: "v3|v4",
    });
    expect(wallNear(testMap, { x: 388, y: 160 }, 14)).toEqual({
      sector: "sector-2",
      wall: "v3|v4",
    });
  });
});

describe("addRoom", () => {
  it("keeps the starter looks for a room drawn on its own", () => {
    const { map, id } = addRoom(blank, box(0, 0, 128, 128));
    expect(map.sectors.find((sector) => sector.id === id)).toMatchObject({
      light: 160,
      wallTexture: "STARTAN3",
      floorTexture: "FLOOR4_8",
      ceilingTexture: "CEIL3_5",
    });
  });

  it("gives a door between two rooms their looks and keeps its face", () => {
    const { map, id } = addRoom(rockRooms(), box(256, 96, 272, 160));
    const door = setRoomDoor(map, id, defaultDoor).sectors.find(
      (sector) => sector.id === id,
    );
    expect(door).toMatchObject({
      light: 192,
      wallTexture: "ROCKRED1",
      floorTexture: "RROCK19",
      ceilingTexture: "FLAT5_7",
      door: { texture: "BIGDOOR2" },
    });
  });

  it("follows the neighbour it shares the most wall with", () => {
    const rooms = addRoom(rockRooms(), box(0, 256, 128, 384), {
      wallTexture: "MARBLE1",
      floorTexture: "FLAT1",
    }).map;
    const below = addRoom(rooms, box(128, 256, 528, 320));
    expect(below.map.sectors.at(-1)).toMatchObject({
      wallTexture: "ROCKRED1",
      floorTexture: "RROCK19",
    });
    const beside = addRoom(rooms, box(128, 256, 192, 384));
    expect(beside.map.sectors.at(-1)).toMatchObject({
      wallTexture: "MARBLE1",
      floorTexture: "FLAT1",
    });
  });

  it("lets textures passed in win over the neighbour's", () => {
    const { map, id } = addRoom(rockRooms(), box(256, 96, 272, 160), {
      wallTexture: "METAL",
    });
    expect(map.sectors.find((sector) => sector.id === id)).toMatchObject({
      wallTexture: "METAL",
      floorTexture: "RROCK19",
    });
  });
});

describe("newRoomLooks", () => {
  it("previews a room's looks from the corners placed so far", () => {
    const map = rockRooms();
    expect(newRoomLooks(map, [])).toMatchObject({ wallTexture: "STARTAN3" });
    expect(
      newRoomLooks(map, [
        { x: 256, y: 96 },
        { x: 256, y: 160 },
      ]),
    ).toMatchObject({ wallTexture: "ROCKRED1", light: 192 });
  });
});

describe("addRoomOnSide", () => {
  it("copies the room it builds from over a wider neighbour", () => {
    const rooms = addRoom(rockRooms(), box(528, -512, 640, 512), {
      wallTexture: "MARBLE1",
    }).map;
    const added = addRoomOnSide(rooms, "sector-2", "south", 512);
    expect(added?.map.sectors.at(-1)).toMatchObject({
      wallTexture: "ROCKRED1",
      light: 192,
    });
  });
});

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ] satisfies Point[];
}

function rockRooms() {
  const west = addRoom(blank, box(0, 0, 256, 256), {
    light: 192,
    wallTexture: "ROCKRED1",
    floorTexture: "RROCK19",
    ceilingTexture: "FLAT5_7",
  });
  return addRoom(west.map, box(272, 0, 528, 256), {
    light: 192,
    wallTexture: "ROCKRED1",
    floorTexture: "RROCK19",
    ceilingTexture: "FLAT5_7",
  }).map;
}
