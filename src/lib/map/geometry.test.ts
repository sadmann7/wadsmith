import { describe, expect, it } from "vitest";

import type { GameMap, Point, Sector } from "./types";

import {
  pointInPolygon,
  sectorAt,
  sectorPolygon,
  wallOwners,
} from "./geometry";
import { testMap } from "./test-map";

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

  it("finds the room drawn inside another, whichever is listed first", () => {
    const vertices = {
      a: { x: 0, y: 0 },
      b: { x: 400, y: 0 },
      c: { x: 400, y: 400 },
      d: { x: 0, y: 400 },
      e: { x: 100, y: 100 },
      f: { x: 200, y: 100 },
      g: { x: 200, y: 200 },
      h: { x: 100, y: 200 },
    };
    const outer = room("outer", ["a", "b", "c", "d"]);
    const inner = room("inner", ["e", "f", "g", "h"]);
    for (const sectors of [
      [outer, inner],
      [inner, outer],
    ]) {
      const map: GameMap = { vertices, sectors, things: [], switches: [] };
      expect(sectorAt(map, { x: 150, y: 150 })?.id).toBe("inner");
      expect(sectorAt(map, { x: 50, y: 50 })?.id).toBe("outer");
    }
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

function everyRoomHolding(map: GameMap, point: Point) {
  return map.sectors.find((sector) =>
    pointInPolygon(point, sectorPolygon(map, sector)),
  );
}

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
