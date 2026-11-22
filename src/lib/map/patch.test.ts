import {
  applyPatch,
  diffMaps,
  getIsEmptyPatch,
  parsePatch,
  patchKeys,
  withoutKeys,
} from "@rooms/map-patch";
import { describe, expect, it } from "vitest";

import { addThing, removeThing, updateSector, updateThing } from "./edit";
import { testMap } from "./test-map";

describe("map patches", () => {
  it("carries only the entities an edit changed", () => {
    const moved = updateThing(testMap, "imp-1", { x: 800 });
    const patch = diffMaps(testMap, moved);
    expect(patch).toEqual({
      set: { things: { "imp-1": { ...testMap.things[3], x: 800 } } },
    });
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

  it("refuses a patch that isn't one", () => {
    expect(parsePatch({ set: { things: { a: { id: "a" } } } })).not.toBeNull();
    expect(parsePatch({ set: { things: { a: { id: "b" } } } })).toBeNull();
    expect(parsePatch({ set: { secrets: {} } })).toBeNull();
    expect(parsePatch({ set: { vertices: { v: 3 } } })).toBeNull();
    expect(parsePatch({ fields: { name: "x" } })).toBeNull();
    expect(parsePatch("x")).toBeNull();
    expect(
      parsePatch(JSON.parse('{"set":{"lines":{"__proto__":{}}}}')),
    ).toBeNull();
  });
});
