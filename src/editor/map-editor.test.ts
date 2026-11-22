import { describe, expect, it } from "vitest";

import { testMap } from "@/map/test-map";
import type { GameMap } from "@/map/types";
import { mapEditor } from "./map-editor";

type Instance = ReturnType<typeof mapEditor>;

const id = "map";

interface Slot {
  selects: {
    subscribe: (part: object, listener: () => void, props: object) => void;
  };
}

const { slots } = mapEditor as unknown as { slots: Record<string, Slot> };

// Wires parts the way a renderer does, so a change reaches a part only when
// its slot's `selects` lets it through.
function listen(instance: Instance) {
  const heard: string[] = [];
  const hear = (slot: string, props: Record<string, unknown>) => {
    const part = instance.part(slot as never, props as never);
    slots[slot].selects.subscribe(
      part,
      () => heard.push(`${slot} ${part.key}`),
      props,
    );
  };
  const [start, corridor, arena] = testMap.sectors;
  hear("sector", { value: start.id, corners: start.vertices, door: false });
  hear("sector", { value: arena.id, corners: arena.vertices, door: false });
  hear("wall", { value: "v1|v15", from: "v1", to: "v15" });
  hear("wall", { value: "v9|v10", from: "v9", to: "v10" });
  hear("handle", { value: "v1" });
  hear("handle", { value: "v10" });
  hear("handle", { value: "thing:imp-1" });
  hear("port", { value: "door:sector-4" });
  hear("label", { value: corridor.id, corners: corridor.vertices });
  return { heard: () => heard.splice(0).toSorted() };
}

function moved(map: GameMap, corner: string, dx: number): GameMap {
  const point = map.vertices[corner];
  return {
    ...map,
    vertices: { ...map.vertices, [corner]: { x: point.x + dx, y: point.y } },
  };
}

describe("map editor parts", () => {
  it("leave every shape alone on a pan or zoom", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.api.viewport.panBy(40, 0);
    instance.api.viewport.zoomTo(2);
    expect(parts.heard()).toEqual(["label sector-2", "label sector-2"]);
  });

  it("wake only the parts of a moved corner", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.setOptions({ id, map: moved(testMap, "v1", 8) });
    expect(parts.heard()).toEqual([
      "handle v1",
      "port door:sector-4",
      "port door:sector-4",
      "sector sector-1",
      "wall v1|v15",
    ]);
  });

  it("wake the parts of a dragged corner, and every shape it may reshape", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    const { store } = instance.part("handle", { value: "v1" });
    const keys = ["v1"];
    const dragged = [
      "handle v1",
      "label sector-2",
      "port door:sector-4",
      "sector sector-1",
      "sector sector-3",
      "wall v1|v15",
    ];
    store.set({ moving: { keys, dx: 8, dy: 0 } });
    expect(parts.heard()).toEqual(dragged);
    store.set({ moving: { keys, dx: 16, dy: 0 } });
    expect(parts.heard()).toEqual(dragged);
    store.set({ moving: null });
    expect(parts.heard()).toEqual(dragged);
  });

  it("wake a part for its own selection and highlight", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.setOptions({ id, map: testMap, selection: ["v10"] });
    expect(parts.heard()).toEqual(["handle v10"]);
    instance.setOptions({
      id,
      map: testMap,
      selection: ["v10"],
      activeSector: "sector-3",
    });
    expect(parts.heard()).toEqual(["sector sector-3"]);
    instance.setOptions({
      id,
      map: testMap,
      selection: ["v10"],
      activeSector: "sector-3",
      highlightedWall: "v9|v10",
    });
    expect(parts.heard()).toEqual(["wall v9|v10"]);
  });

  it("drop the pressed corner on the grid and carry the rest along", () => {
    let result: GameMap | null = null;
    const map = moved(testMap, "v15", 3);
    const instance = mapEditor({
      id,
      map,
      onMapChange: (next) => {
        result = next;
      },
    });
    const { store } = instance.part("handle", { value: "v1" });
    const keys = ["v1", "v15"];
    store.set({ moving: { keys, dx: 5, dy: 0 } });
    store.set({ moving: null });
    instance.api.move.moveBy(keys, 5, 0, { reason: "drag" });
    expect(result!.vertices.v1).toEqual({ x: 8, y: 0 });
    expect(result!.vertices.v15).toEqual({ x: 171, y: 0 });
  });

  it("join a corner dropped onto another corner", () => {
    let result: GameMap | null = null;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: (next) => {
        result = next;
      },
    });
    const { store } = instance.part("handle", { value: "v15" });
    store.set({ moving: { keys: ["v15"], dx: 64, dy: 0 } });
    store.set({ moving: null });
    instance.api.move.moveBy(["v15"], 64, 0, { reason: "drag" });
    expect(result!.vertices.v15).toBeUndefined();
    expect(result!.sectors[0].vertices).not.toContain("v15");
    expect(result!.sectors[0].vertices).toContain("v16");
  });

  it("commit nothing for a drop that lands where it started", () => {
    let changes = 0;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: () => {
        changes += 1;
      },
    });
    const { store } = instance.part("handle", { value: "v1" });
    store.set({ moving: { keys: ["v1"], dx: 3, dy: 0 } });
    store.set({ moving: null });
    expect(instance.api.move.moveBy(["v1"], 3, 0, { reason: "drag" })).toBe(
      false,
    );
    expect(changes).toBe(0);
  });

  it("wake no shape for the same map rendered again", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.setOptions({ id, map: testMap });
    expect(parts.heard()).toEqual([]);
    instance.setOptions({ id, map: { ...testMap } });
    expect(parts.heard()).toEqual(["port door:sector-4", "port door:sector-4"]);
  });
});
