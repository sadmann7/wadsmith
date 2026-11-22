import { describe, expect, it } from "vitest";

import {
  pointInPolygon,
  sectorAt,
  sectorBox,
  sectorPolygon,
  wallOwners,
} from "./geometry";
import { testMap } from "./test-map";
import type { GameMap, Point, Sector } from "./types";

function room(id: string, corners: string[]): Sector {
  return {
    id,
    name: id,
    vertices: corners,
    floor: 0,
    ceiling: 128,
    light: 160,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
  };
}

function everyRoomHolding(map: GameMap, point: Point) {
  return map.sectors.find((sector) =>
    pointInPolygon(point, sectorPolygon(map, sector)),
  );
}

describe("sectorAt", () => {
  it("finds what a scan of every room would", () => {
    const points = [
      ...Object.values(testMap.vertices).flatMap((point) => [
        { x: point.x + 3, y: point.y + 3 },
        { x: point.x - 3, y: point.y - 3 },
      ]),
      { x: 100, y: 100 },
      { x: 440, y: 160 },
      { x: 700, y: 100 },
      { x: 500, y: 160 },
      { x: -500, y: -500 },
      { x: 5000, y: 5000 },
    ];
    expect(points.map((point) => sectorAt(testMap, point)?.id)).toEqual(
      points.map((point) => everyRoomHolding(testMap, point)?.id),
    );
  });

  it("prefers the room listed first where rooms overlap", () => {
    const map: GameMap = {
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 200, y: 0 },
        c: { x: 200, y: 200 },
        d: { x: 0, y: 200 },
        e: { x: 100, y: 100 },
        f: { x: 300, y: 100 },
        g: { x: 300, y: 300 },
        h: { x: 100, y: 300 },
      },
      sectors: [
        room("outer", ["a", "b", "c", "d"]),
        room("inner", ["e", "f", "g", "h"]),
      ],
      things: [],
      switches: [],
    };
    expect(sectorAt(map, { x: 150, y: 150 })?.id).toBe("outer");
    expect(sectorAt(map, { x: 250, y: 250 })?.id).toBe("inner");
    expect(sectorAt(map, { x: 50, y: 250 })).toBeUndefined();
  });

  it("finds a room far from the origin and on both sides of a grid line", () => {
    const map: GameMap = {
      vertices: {
        a: { x: -20000, y: 500 },
        b: { x: -19000, y: 500 },
        c: { x: -19000, y: 530 },
        d: { x: -20000, y: 530 },
      },
      sectors: [room("far", ["a", "b", "c", "d"])],
      things: [],
      switches: [],
    };
    expect(sectorAt(map, { x: -19500, y: 511 })?.id).toBe("far");
    expect(sectorAt(map, { x: -19500, y: 513 })?.id).toBe("far");
    expect(sectorAt(map, { x: -19500, y: 540 })).toBeUndefined();
  });

  it("never finds a room with a missing corner", () => {
    const map: GameMap = {
      ...testMap,
      sectors: [...testMap.sectors, room("torn", ["v1", "v2", "gone"])],
    };
    expect(sectorAt(map, { x: 100, y: 100 })?.id).toBe("sector-1");
    expect(sectorAt(map, { x: 300, y: 10 })?.id).toBe("sector-1");
  });
});

describe("sectorBox", () => {
  it("bounds a room", () => {
    expect(sectorBox(testMap, testMap.sectors[1])).toEqual({
      left: 384,
      top: 96,
      right: 496,
      bottom: 224,
    });
  });
});

describe("wallOwners", () => {
  it("keeps a map's owners and works a new map's out again", () => {
    expect(wallOwners(testMap)).toBe(wallOwners(testMap));
    const copy = { ...testMap };
    expect(wallOwners(copy)).not.toBe(wallOwners(testMap));
    expect([...wallOwners(copy)]).toEqual([...wallOwners(testMap)]);
    expect(
      wallOwners(testMap)
        .get("v3|v4")
        ?.map((sector) => sector.id),
    ).toEqual(["sector-1", "sector-2"]);
  });
});
