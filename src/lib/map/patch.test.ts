import {
  applyPatch,
  diffMaps,
  fitPatch,
  getIsEmptyPatch,
  parsePatch,
  patchKeys,
  withoutKeys,
} from "@rooms/map-patch";
import { describe, expect, it } from "vitest";

import type { GameMap } from "./types";

import {
  addThing,
  removeThing,
  setIdSuffix,
  splitWall,
  updateSector,
  updateThing,
} from "./edit";
import { testMap } from "./test-map";
import { validateMap } from "./validate";

describe("map patches", () => {
  it("carries only the entities an edit changed", () => {
    const moved = updateThing(testMap, "imp-1", { x: 800 });
    const patch = diffMaps(testMap, moved);
    expect(patch).toEqual({ merge: { things: { "imp-1": { x: 800 } } } });
    expect(applyPatch(testMap, patch)).toEqual(moved);
    expect(getIsEmptyPatch(diffMaps(testMap, testMap))).toBe(true);
  });

  it("adds, removes and changes entities of every kind", () => {
    const added = addThing(testMap, "medikit", { x: 96, y: 96 }).map;
    const changed = removeThing(
      updateSector(
        { ...added, complevel: "boom", lines: { "v1|v6": { secret: true } } },
        "sector-2",
        { light: 50 },
      ),
      "zombieman-1",
    );
    const patch = diffMaps(testMap, changed);
    expect(patchKeys(patch).toSorted()).toEqual(
      [
        "field:complevel",
        "lines:v1|v6",
        "sectors:sector-2",
        "things:medikit-1",
        "things:zombieman-1",
      ].toSorted(),
    );
    expect(applyPatch(testMap, patch)).toEqual(changed);
    // And back again, with the removed thing back at the end of its list.
    const back = applyPatch(changed, diffMaps(changed, testMap));
    const byId = (things: typeof testMap.things) =>
      things.toSorted((a, b) => a.id.localeCompare(b.id));
    expect({ ...back, things: byId(back.things) }).toEqual({
      ...testMap,
      things: byId(testMap.things),
    });
  });

  it("combines two people's edits to different fields of one thing", () => {
    const mine = diffMaps(
      testMap,
      updateSector(testMap, "sector-3", { floorTexture: "FLAT1" }),
    );
    const theirs = diffMaps(
      testMap,
      updateSector(testMap, "sector-3", { floor: 8 }),
    );
    const both = applyPatch(applyPatch(testMap, mine), theirs);
    expect(both.sectors[2]).toMatchObject({ floorTexture: "FLAT1", floor: 8 });
    // A change to something removed meanwhile does nothing.
    const gone = applyPatch(testMap, {
      set: { sectors: { "sector-3": null } },
    });
    expect(applyPatch(gone, mine)).toEqual(gone);
  });

  it("combines two people's edits to different things", () => {
    const mine = diffMaps(testMap, updateThing(testMap, "imp-1", { x: 800 }));
    const theirs = diffMaps(
      testMap,
      updateSector(testMap, "sector-3", { light: 90 }),
    );
    const both = applyPatch(applyPatch(testMap, mine), theirs);
    expect(both.things[3].x).toBe(800);
    expect(both.sectors[2].light).toBe(90);
    expect(applyPatch(applyPatch(testMap, theirs), mine)).toEqual(both);
  });

  it("leaves out the entities one is still waiting on", () => {
    const theirs = diffMaps(
      testMap,
      updateThing(updateSector(testMap, "sector-3", { light: 90 }), "imp-1", {
        x: 1,
      }),
    );
    const kept = withoutKeys(theirs, new Set(["things:imp-1"]));
    expect(patchKeys(kept)).toEqual(["sectors:sector-3"]);
    expect(
      getIsEmptyPatch(withoutKeys(kept, new Set(["sectors:sector-3"]))),
    ).toBe(true);
  });

  it("keeps a list in the order of the map it was made from", () => {
    const [first, ...rest] = testMap.things;
    const reordered = { ...testMap, things: [...rest, first] };
    const patch = diffMaps(testMap, reordered);
    expect(patch).toEqual({
      order: { things: reordered.things.map((t) => t.id) },
    });
    expect(applyPatch(testMap, patch)).toEqual(reordered);
    const added = addThing(testMap, "medikit", { x: 96, y: 96 }).map;
    expect(diffMaps(testMap, added).order).toBeUndefined();
  });

  it("turns away an add under an id the map holds for something else", () => {
    const imp = testMap.things[3];
    const same = { set: { things: { [imp.id]: imp } } };
    expect(fitPatch(testMap, same)).toEqual({ patch: same });
    expect(
      fitPatch(testMap, { set: { things: { [imp.id]: { ...imp, x: 1 } } } }),
    ).toEqual({ error: "taken" });
    expect(
      fitPatch(testMap, { set: { vertices: { v1: { x: 9, y: 9 } } } }),
    ).toEqual({ error: "taken" });
  });

  it("joins two first settings for one wall", () => {
    const ours = { ...testMap, lines: { "v1|v2": { secret: true } } };
    const fit = fitPatch(ours, {
      set: { lines: { "v1|v2": { mapped: true } } },
    });
    const patch = "patch" in fit ? fit.patch : {};
    expect(patch).toEqual({ merge: { lines: { "v1|v2": { mapped: true } } } });
    expect(applyPatch(ours, patch).lines).toEqual({
      "v1|v2": { secret: true, mapped: true },
    });
  });

  it("keeps corners two people add to one room's walls at once", () => {
    for (const [first, second] of [
      [
        { x: 192, y: 320 },
        { x: 0, y: 160 },
      ],
      [
        { x: 0, y: 160 },
        { x: 192, y: 320 },
      ],
    ]) {
      const wallOf = (point: { y: number }) =>
        point.y === 320 ? "v5|v6" : "v1|v6";
      const ours = split("aaa", wallOf(first), first);
      const theirs = split("bbb", wallOf(second), second);
      const landed = land(land(testMap, ours), theirs);
      expect("map" in landed).toBe(true);
      if (!("map" in landed)) continue;
      const room = landed.map.sectors[0];
      expect(room.vertices).toEqual(
        expect.arrayContaining([ours.id, theirs.id]),
      );
      expect(validateMap(landed.map)).toEqual(validateMap(testMap));
    }
  });

  it("turns away a second change to one wall, or a reshape of a changed room", () => {
    const corner = split("aaa", "v5|v6", { x: 192, y: 320 });
    for (const point of [
      { x: 192, y: 320 },
      { x: 96, y: 320 },
    ]) {
      const other = split("bbb", "v5|v6", point);
      expect(land(land(testMap, corner), other)).toEqual({
        error: "reshaped",
      });
    }
    const square = {
      ...testMap,
      sectors: testMap.sectors.map((sector, at) =>
        at === 0
          ? {
              ...sector,
              vertices: sector.vertices.filter((id) => id !== "v15"),
            }
          : sector,
      ),
    };
    const landed = land(land(testMap, corner), { map: square, base: testMap });
    expect(landed).toEqual({ error: "reshaped" });
  });

  it("keeps wall paint two people change on one room at once", () => {
    const paint = (wall: string, texture: string) => ({
      map: updateSector(testMap, "sector-1", {
        wallOverrides: { ...testMap.sectors[0].wallOverrides, [wall]: texture },
      }),
      base: testMap,
    });
    const landed = land(land(testMap, paint("v5|v6", "BROWN1")), {
      ...paint("v1|v6", "GRAY1"),
    });
    expect("map" in landed && landed.map.sectors[0].wallOverrides).toEqual({
      ...testMap.sectors[0].wallOverrides,
      "v5|v6": "BROWN1",
      "v1|v6": "GRAY1",
    });
  });

  it("puts corners added before a room's first corner on its last wall", () => {
    const before = ["v1", "v2", "v3"];
    const map = {
      ...testMap,
      sectors: [{ ...testMap.sectors[0], vertices: before }],
    };
    const patch = {
      merge: { sectors: { "sector-1": { vertices: ["x", ...before, "y"] } } },
      was: { sectors: { "sector-1": { vertices: before } } },
    };
    const fit = fitPatch(
      {
        ...map,
        sectors: [{ ...map.sectors[0], vertices: ["v1", "v2", "z", "v3"] }],
      },
      patch,
    );
    expect(
      "patch" in fit && fit.patch.merge?.sectors?.["sector-1"].vertices,
    ).toEqual(["v1", "v2", "z", "v3", "y", "x"]);
  });

  it("refuses a patch that isn't one", () => {
    expect(
      parsePatch({ was: { sectors: { a: { vertices: ["v1"] } } } }),
    ).not.toBeNull();
    expect(parsePatch({ was: { sectors: { a: { name: "x" } } } })).toBeNull();
    expect(parsePatch({ order: { things: ["a"] } })).not.toBeNull();
    expect(parsePatch({ order: { vertices: ["a"] } })).toBeNull();
    expect(parsePatch({ order: { things: [1] } })).toBeNull();
    expect(parsePatch({ set: { things: { a: { id: "a" } } } })).not.toBeNull();
    expect(parsePatch({ set: { things: { a: { id: "b" } } } })).toBeNull();
    expect(parsePatch({ set: { secrets: {} } })).toBeNull();
    expect(parsePatch({ set: { vertices: { v: 3 } } })).toBeNull();
    expect(parsePatch({ fields: { name: "x" } })).not.toBeNull();
    expect(parsePatch({ fields: { vertices: {} } })).toBeNull();
    expect(parsePatch({ merge: { things: { a: { id: "b" } } } })).toBeNull();
    expect(parsePatch({ merge: { things: { a: null } } })).toBeNull();
    expect(parsePatch("x")).toBeNull();
    expect(
      parsePatch(JSON.parse('{"set":{"lines":{"__proto__":{}}}}')),
    ).toBeNull();
  });
});

function split(suffix: string, wall: string, point: { x: number; y: number }) {
  setIdSuffix(suffix);
  try {
    const done = splitWall(testMap, wall, point);
    if (!done) throw new Error("No split.");
    return { ...done, base: testMap };
  } finally {
    setIdSuffix("");
  }
}

// Sends one browser's edit, made on the map it had, to the server's map.
function land(
  on: GameMap | { map: GameMap } | { error: string },
  edit: { map: GameMap; base: GameMap },
) {
  if ("error" in on) return on;
  const map = "map" in on && !("sectors" in on) ? on.map : (on as GameMap);
  const fit = fitPatch(map, diffMaps(edit.base, edit.map));
  return "error" in fit ? fit : { map: applyPatch(map, fit.patch) };
}
