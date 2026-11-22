import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";
import { addRoom, updateSector, updateThing } from "@/lib/map/edit";
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

  it("keeps corners someone else's room uses since", () => {
    const history = createEditHistory(options);
    const mine = addRoom(testMap, [
      { x: -200, y: 0 },
      { x: -100, y: 0 },
      { x: -100, y: 100 },
      { x: -200, y: 100 },
    ]);
    history.record(testMap, mine.map);
    const corners = mine.map.sectors.at(-1)?.vertices ?? [];
    // Another editor draws a room against two of those corners.
    const [a, b] = corners;
    const theirs = {
      ...mine.map,
      vertices: { ...mine.map.vertices, far: { x: -150, y: -80 } },
      sectors: [
        ...mine.map.sectors,
        { ...testMap.sectors[0], id: "sector-9", vertices: [a, b, "far"] },
      ],
    };
    const undone = defined(history.undo(theirs));
    expect(undone.sectors.some((sector) => sector.id === mine.id)).toBe(false);
    expect(undone.vertices[a]).toEqual(mine.map.vertices[a]);
    expect(undone.vertices[b]).toEqual(mine.map.vertices[b]);
    // The corners only this room used go with it.
    expect(undone.vertices[corners[2]]).toBeUndefined();
  });

  it("won't bring back a room whose corners someone else removed", () => {
    const history = createEditHistory(options);
    const removed = {
      ...testMap,
      sectors: testMap.sectors.filter((sector) => sector.id !== "sector-2"),
    };
    history.record(testMap, removed);
    // Another editor then removes corners the corridor used.
    const vertices = Object.fromEntries(
      Object.entries(removed.vertices).filter(
        ([id]) => id !== "v13" && id !== "v14",
      ),
    );
    const theirs = {
      ...removed,
      vertices,
      sectors: removed.sectors.filter(
        (sector) => !sector.vertices.some((id) => id === "v13" || id === "v14"),
      ),
    };
    expect(history.undo(theirs)).toBeUndefined();
  });

  it("forgets its steps when the map is swapped whole", () => {
    const history = createEditHistory(options);
    history.record(testMap, updateThing(testMap, "imp-1", { x: 1 }));
    history.clear();
    expect(history.canUndo()).toBe(false);
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

  it("undoes one group's steps however long it ran", () => {
    const history = createEditHistory({ limit: 10, groupDelay: 0 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, "agent-1", Infinity);
    const second = updateSector(first, "sector-3", { light: 90 });
    history.record(first, second, "agent-1", Infinity);
    const mine = updateThing(second, "player-1", { x: 120 });
    history.record(second, mine);
    const undone = defined(history.undoGroup("agent-1", mine));
    expect(undone.things.find((thing) => thing.id === "imp-1")?.x).toBe(832);
    expect(undone.sectors[2].light).toBe(testMap.sectors[2].light);
    expect(undone.things.find((thing) => thing.id === "player-1")?.x).toBe(120);
    expect(history.undoGroup("agent-1", undone)).toBeUndefined();
    expect(history.canUndo()).toBe(true);
  });
});
