import { describe, expect, it } from "vitest";

import { applyPositions, positionsOf, updateSector, wallNear } from "./edit";
import { testMap } from "./test-map";

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
