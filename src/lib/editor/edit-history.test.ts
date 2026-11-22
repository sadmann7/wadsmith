import { describe, expect, it } from "vitest";

import { updateSector, updateThing } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";

import { createEditHistory } from "./edit-history";

const options = { limit: 3, groupDelay: 60_000 };

describe("an edit history", () => {
  it("undoes and redoes one's own edits", () => {
    const history = createEditHistory(options);
    const moved = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, moved);
    expect(history.canUndo()).toBe(true);
    const back = history.undo(moved);
    expect(back).toEqual(testMap);
    expect(history.canRedo()).toBe(true);
    expect(history.redo(testMap)).toEqual(moved);
    expect(history.undo(testMap)).toBeDefined();
    expect(history.undo(testMap)).toBeUndefined();
  });

  it("leaves someone else's later edit alone", () => {
    const history = createEditHistory(options);
    const mine = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, mine);
    // Another editor changes a room meanwhile.
    const theirs = updateSector(mine, "sector-3", { light: 90 });
    const undone = history.undo(theirs);
    expect(undone?.things[3].x).toBe(testMap.things[3].x);
    expect(undone?.sectors[2].light).toBe(90);
  });

  it("joins a group's edits into one step and keeps only so many", () => {
    const history = createEditHistory(options);
    const a = updateThing(testMap, "imp-1", { x: 1 });
    const b = updateThing(a, "imp-1", { x: 2 });
    history.record(testMap, a, "drag");
    history.record(a, b, "drag");
    expect(history.undo(b)).toEqual(testMap);
    expect(history.canUndo()).toBe(false);

    let map = testMap;
    for (let x = 10; x < 15; x += 1) {
      const next = updateThing(map, "imp-1", { x });
      history.record(map, next);
      map = next;
    }
    let steps = 0;
    while (history.undo(map)) steps += 1;
    expect(steps).toBe(3);
    // An edit that changes nothing adds no step.
    const fresh = createEditHistory(options);
    fresh.record(testMap, testMap);
    expect(fresh.canUndo()).toBe(false);
  });
});
