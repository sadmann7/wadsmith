import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

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
    history.record(testMap, a, { group: "drag" });
    history.record(a, b, { group: "drag" });
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

  it("undoes a batch's steps one at a time or all together", () => {
    const history = createEditHistory({ limit: 10, groupDelay: 60_000 });
    const batch = { batch: "agent-1" };
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, batch);
    const second = updateSector(first, "sector-3", { light: 90 });
    history.record(first, second, batch);
    const mine = updateThing(second, "player-1", { x: 120 });
    history.record(second, mine);
    const third = updateThing(mine, "imp-1", { x: 900 });
    history.record(mine, third, batch);

    const back = defined(history.undo(third));
    expect(imp(back)).toBe(800);
    expect(back.sectors[2].light).toBe(90);
    expect(history.redo(back)).toEqual(third);

    const undone = defined(history.undoBatch("agent-1", third));
    expect(imp(undone)).toBe(imp(testMap));
    expect(undone.sectors[2].light).toBe(testMap.sectors[2].light);
    expect(player(undone)).toBe(120);
    expect(history.canRedo()).toBe(false);
    expect(history.undo(undone)).toEqual(
      updateThing(undone, "player-1", { x: player(testMap) }),
    );
    expect(history.canUndo()).toBe(false);
  });

  it("undoes the rest of a batch after some steps were undone by hand", () => {
    const history = createEditHistory({ limit: 10, groupDelay: 60_000 });
    const batch = { batch: "agent-1" };
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, batch);
    const second = updateSector(first, "sector-3", { light: 90 });
    history.record(first, second, batch);

    const partly = defined(history.undo(second));
    expect(history.undoBatch("agent-1", partly)).toEqual(testMap);
    expect(history.canRedo()).toBe(false);

    history.record(testMap, first, batch);
    const all = defined(history.undo(first));
    expect(history.undoBatch("agent-1", all)).toBe(all);
    expect(history.canRedo()).toBe(false);
  });

  it("keeps a redone step in its batch", () => {
    const history = createEditHistory({ limit: 10, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, { batch: "agent-1" });
    const back = defined(history.undo(first));
    const again = defined(history.redo(back));
    expect(history.undoBatch("agent-1", again)).toEqual(testMap);
  });

  it("keeps a batch whole when its oldest steps pass the limit", () => {
    const history = createEditHistory({ limit: 3, groupDelay: 60_000 });
    let map = testMap;
    for (let x = 10; x < 16; x += 1) {
      const next = updateThing(map, "imp-1", { x });
      history.record(map, next, { batch: "agent-1" });
      map = next;
    }
    const back = defined(history.undo(map));
    expect(imp(back)).toBe(14);
    expect(history.undoBatch("agent-1", back)).toEqual(testMap);
  });

  it("keeps a batch whole when hand edits push its steps past the limit", () => {
    const history = createEditHistory({ limit: 3, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, { batch: "agent-1" });
    const mine = updateThing(first, "player-1", { x: 120 });
    history.record(first, mine);
    const second = updateSector(mine, "sector-3", { light: 90 });
    history.record(mine, second, { batch: "agent-1" });
    let map = second;
    for (let x = 10; x < 12; x += 1) {
      const next = updateThing(map, "player-1", { x });
      history.record(map, next);
      map = next;
    }
    const undone = defined(history.undoBatch("agent-1", map));
    expect(imp(undone)).toBe(imp(testMap));
    expect(undone.sectors[2].light).toBe(testMap.sectors[2].light);
    expect(player(undone)).toBe(11);
  });

  it("won't undo a batch none of whose steps are left", () => {
    const history = createEditHistory({ limit: 2, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, { batch: "agent-1" });
    let map = first;
    for (let x = 10; x < 12; x += 1) {
      const next = updateThing(map, "player-1", { x });
      history.record(map, next);
      map = next;
    }
    expect(history.hasBatch("agent-1")).toBe(false);
    expect(history.undoBatch("agent-1", map)).toBeUndefined();
  });

  it("undoes only the newest step by hand once a batch passes the limit", () => {
    const history = createEditHistory({ limit: 2, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, { batch: "agent-1" });
    const mine = updateThing(first, "imp-1", { x: 900 });
    history.record(first, mine);
    const second = updateSector(mine, "sector-3", { light: 90 });
    history.record(mine, second, { batch: "agent-1" });
    const back = defined(history.undo(second));
    expect(imp(back)).toBe(900);
    expect(back.sectors[2].light).toBe(testMap.sectors[2].light);
    expect(imp(defined(history.undo(back)))).toBe(800);
    expect(history.canUndo()).toBe(false);
  });

  it("forgets a batch with the rest of the history", () => {
    const history = createEditHistory({ limit: 1, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, { batch: "agent-1" });
    const second = updateThing(first, "imp-1", { x: 900 });
    history.record(first, second, { batch: "agent-1" });
    history.clear();
    expect(history.hasBatch("agent-1")).toBe(false);
    expect(history.undoBatch("agent-1", second)).toBeUndefined();
  });

  it("keeps the redo of a hand edit when undoing a batch", () => {
    const history = createEditHistory({ limit: 10, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    history.record(testMap, first, { batch: "agent-1" });
    const mine = updateThing(first, "player-1", { x: 120 });
    history.record(first, mine);
    const back = defined(history.undo(mine));
    const undone = defined(history.undoBatch("agent-1", back));
    expect(imp(undone)).toBe(imp(testMap));
    expect(player(defined(history.redo(undone)))).toBe(120);
  });

  it("names the steps still on the map", () => {
    const history = createEditHistory({ limit: 2, groupDelay: 60_000 });
    const first = updateThing(testMap, "imp-1", { x: 800 });
    const a = history.record(testMap, first, { batch: "agent-1" });
    expect(history.record(first, first)).toBeUndefined();
    const second = updateThing(first, "imp-1", { x: 810 });
    const b = history.record(first, second, { group: "nudge" });
    const third = updateThing(second, "imp-1", { x: 820 });
    expect(history.record(second, third, { group: "nudge" })).toBe(b);
    const fourth = updateSector(third, "sector-3", { light: 90 });
    const c = history.record(third, fourth, { batch: "agent-1" });
    expect(history.getDoneIds()).toEqual(new Set([a, b, c]));

    const back = defined(history.undo(fourth));
    expect(history.getDoneIds()).toEqual(new Set([a, b]));
    expect(history.redo(back)).toEqual(fourth);
    expect(history.getDoneIds()).toEqual(new Set([a, b, c]));

    defined(history.undoBatch("agent-1", fourth));
    expect(history.getDoneIds()).toEqual(new Set([b]));
  });
});

function imp(map: GameMap) {
  return map.things.find((thing) => thing.id === "imp-1")?.x;
}

function player(map: GameMap) {
  return map.things.find((thing) => thing.id === "player-1")?.x;
}
