import { partAttrs } from "@ui-sdk/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { applyPositions, removeThing } from "@/lib/map/edit";
import { pickedRooms } from "@/lib/map/fragment";
import { roomPoint } from "@/lib/map/geometry";
import { drawRoom, removeCorner } from "@/lib/map/reshape";
import { testMap } from "@/lib/map/test-map";
import { SceneCamera } from "@/lib/preview/scene-camera";

import { mapEditor, type MapGrab, type MapTool } from "./map-editor";

type Instance = ReturnType<typeof mapEditor>;

const id = "map";

interface Slot {
  selects: {
    subscribe: (part: object, listener: () => void, props: object) => void;
  };
}

const { slots } = mapEditor as unknown as { slots: Record<string, Slot> };

describe("map editor parts", () => {
  it("leave every shape alone on a pan or zoom", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.api.viewport.panBy(40, 0);
    instance.api.viewport.zoomTo(2);
    expect(parts.heard()).toEqual(["caption sector-2", "caption sector-2"]);
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
      "caption sector-2",
      "handle v1",
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

  it("keep a room's name with the room while it's dragged, even beside a pillar", () => {
    const hall: GameMap = {
      ...testMap,
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 512, y: 0 },
        c: { x: 512, y: 512 },
        d: { x: 0, y: 512 },
        e: { x: 64, y: 8 },
        f: { x: 448, y: 8 },
        g: { x: 448, y: 448 },
        h: { x: 64, y: 448 },
      },
      sectors: [
        {
          ...testMap.sectors[0],
          name: "Hall of the long walkway",
          vertices: ["a", "b", "c", "d"],
          holes: [["e", "f", "g", "h"]],
        },
      ],
      things: [],
      lines: {},
      switches: [],
    };
    const instance = mapEditor({ id, map: hall });
    const props = {
      value: "sector-1",
      corners: ["a", "b", "c", "d"],
      holes: [["e", "f", "g", "h"]],
    };
    const leftOf = () =>
      parseFloat(
        String(partAttrs(instance.part("caption", props)).style).match(
          /left:\s*([-\d.]+)px/,
        )?.[1] ?? "NaN",
      );
    const before = leftOf();
    const { store } = instance.part("handle", { value: "a" });
    store.set({
      moving: {
        keys: ["a", "b", "c", "d", "e", "f", "g", "h"],
        dx: 256,
        dy: 0,
      },
    });
    expect(leftOf()).toBeCloseTo(before + 256);
    store.set({ moving: { keys: ["e", "h"], dx: 56, dy: 0 } });
    const reshaped = applyPositions(hall, {
      e: { x: 120, y: 8 },
      h: { x: 120, y: 448 },
    });
    const spot = roomPoint(reshaped, reshaped.sectors[0]).x;
    expect(spot).not.toBeCloseTo(roomPoint(hall, hall.sectors[0]).x);
    expect(leftOf()).toBeCloseTo(spot);
  });

  it("wake a part for its own selection and highlight", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.setOptions({ id, map: testMap, selection: ["v10"] });
    // A room shows as selected once all its corners are, so it hears each one.
    expect(parts.heard()).toEqual(["handle v10", "sector sector-3"]);
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
    let result = null as GameMap | null;
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
    expect(defined(result).vertices.v1).toEqual({ x: 8, y: 0 });
    expect(defined(result).vertices.v15).toEqual({ x: 171, y: 0 });
  });

  it("join a corner dropped onto another corner", () => {
    let result = null as GameMap | null;
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
    expect(defined(result).vertices.v15).toBeUndefined();
    expect(defined(result).sectors[0].vertices).not.toContain("v15");
    expect(defined(result).sectors[0].vertices).toContain("v16");
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

  it("delete the selected rooms with the things standing in them", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      selection: ["v3", "v13", "v14", "v4", "thing:imp-1"],
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press("Delete"));
    const left = defined(result);
    expect(left.sectors.map((sector) => sector.id)).toEqual([
      "sector-1",
      "sector-3",
      "sector-4",
    ]);
    // The shotgun stood in the corridor, and the imp was picked by itself.
    expect(left.things.map((thing) => thing.id)).toEqual([
      "player-1",
      "zombieman-1",
    ]);
  });

  it("keep a player start when its room is deleted", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      activeSector: "sector-1",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press("Backspace"));
    expect(defined(result).sectors.map((sector) => sector.id)).not.toContain(
      "sector-1",
    );
    expect(defined(result).things.map((thing) => thing.id)).toContain(
      "player-1",
    );
  });

  it("take a lone corner out of its walls in corner mode", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "vertices",
      selection: ["v6"],
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press("Delete"));
    expect(defined(result).vertices.v6).toBeUndefined();
    expect(defined(result).sectors[0].vertices).toEqual([
      "v1",
      "v15",
      "v16",
      "v2",
      "v3",
      "v4",
      "v5",
    ]);
  });

  it("join a corner dropped onto the middle of a wall", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: (next) => {
        result = next;
      },
    });
    const { store } = instance.part("handle", { value: "v12" });
    // The arena's corner at 512,384 lands on the start room's bottom wall.
    store.set({ moving: { keys: ["v12"], dx: -256, dy: -64 } });
    store.set({ moving: null });
    instance.api.move.moveBy(["v12"], -256, -64, { reason: "drag" });
    expect(defined(result).sectors[0].vertices).toContain("v12");
  });

  it("split a room with a line drawn from wall to wall", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "line",
      onMapChange: (next) => {
        result = next;
      },
    });
    const { store } = instance.part("handle", { value: "v1" });
    store.set({
      drawing: [
        { x: 0, y: 256 },
        { x: 384, y: 256 },
      ],
    });
    instance.api.keydown(press("Enter"));
    expect(defined(result).sectors).toHaveLength(testMap.sectors.length + 1);
  });

  it("select every wall in line mode, and swap rooms in sector mode", () => {
    let picked: string[] = [];
    const lines = mapEditor({
      id,
      map: testMap,
      editMode: "lines",
      onSelectionChange: (next) => {
        picked = next;
      },
    });
    lines.api.keydown(press("a", { ctrlKey: true }));
    expect(picked).toContain("wall:v1|v15");
    expect(picked.every((key) => key.startsWith("wall:"))).toBe(true);

    const rooms = mapEditor({
      id,
      map: testMap,
      editMode: "sectors",
      activeSector: "sector-1",
      onSelectionChange: (next) => {
        picked = next;
      },
    });
    rooms.api.keydown(press("i", { ctrlKey: true }));
    expect(picked.filter((key) => key.startsWith("room:"))).toEqual([
      "room:sector-2",
      "room:sector-3",
      "room:sector-4",
    ]);
  });

  it("swap rooms in a row without taking in the one between", () => {
    let map = {
      vertices: {},
      sectors: [],
      things: [],
      switches: [],
    } as GameMap;
    for (const left of [0, 128, 256]) {
      map = drawRoom(map, box(left, 0, left + 128, 128), {}, 1).map;
    }
    const [first, middle, last] = map.sectors.map((sector) => sector.id);
    let picked: string[] = [];
    const instance = mapEditor({
      id,
      map,
      editMode: "sectors",
      activeSector: middle,
      onSelectionChange: (next) => {
        picked = next;
      },
    });
    instance.api.keydown(press("i", { ctrlKey: true }));
    expect(picked).toEqual([`room:${first}`, `room:${last}`]);
    expect(pickedRooms(map, picked, null)).toEqual([first, last]);
  });

  it("select a room narrower than the grid with a click inside it", () => {
    let map = {
      vertices: {},
      sectors: [],
      things: [],
      switches: [],
    } as GameMap;
    for (const [left, right] of [
      [0, 256],
      [272, 528],
      [256, 272],
    ]) {
      map = drawRoom(map, box(left, 0, right, 128), {}, 1).map;
    }
    const door = map.sectors[2].id;
    let active: string | null = null;
    const instance = mapEditor({
      id,
      map,
      grid: 16,
      editMode: "sectors",
      onActiveSectorChange: (next) => {
        active = next;
      },
    });
    instance.api.click(pointer(264, 64));
    expect(active).toBe(door);
  });

  it("nudge a room picked whole, with what stands in it", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "sectors",
      selection: ["room:sector-2"],
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press("ArrowDown"));
    expect(defined(result).vertices.v13).toEqual({ x: 496, y: 104 });
    const shotgun = defined(result).things.find(
      (thing) => thing.id === "shotgun-1",
    );
    expect(shotgun).toMatchObject({ x: 448, y: 168 });
  });

  it("nudge the active room in sector mode", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "sectors",
      activeSector: "sector-2",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press("ArrowDown"));
    expect(defined(result).vertices.v13).toEqual({ x: 496, y: 104 });
  });

  it("raise floors, ceilings and light with Page Up, Home and Alt", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "sectors",
      selection: ["room:sector-1", "room:sector-2"],
      onMapChange: (next, details) => {
        expect(details.reason).toBe("height-key");
        result = next;
      },
    });
    instance.api.keydown(press("PageUp"));
    expect(defined(result).sectors[0].floor).toBe(8);
    expect(defined(result).sectors[1].floor).toBe(-8);
    instance.api.keydown(press("End", { shiftKey: true }));
    expect(defined(result).sectors[0].ceiling).toBe(104);
    instance.api.keydown(press("PageDown", { altKey: true }));
    expect(defined(result).sectors[0].light).toBe(160);
  });

  it("place a thing of the chosen kind with Insert in thing mode", () => {
    let result = null as GameMap | null;
    let picked: string[] = [];
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "things",
      thingKind: "shotgun",
      onMapChange: (next) => {
        result = next;
      },
      onSelectionChange: (next) => {
        picked = next;
      },
    });
    instance.api.pointermove({ clientX: 0, clientY: 0 } as PointerEvent);
    instance.api.keydown(press("Insert"));
    const placed = defined(result).things.at(-1);
    expect(placed?.kind).toBe("shotgun");
    expect(picked).toEqual([`thing:${placed?.id}`]);
  });

  it("zoom a step at a time on each zoom request", () => {
    const instance = mapEditor({ id, map: testMap });
    instance.api.viewport.zoomTo(0.9);
    const zoom = () => instance.api.viewport.get().zoom;
    instance.setOptions({ id, map: testMap, zoomRequest: { id: 1, steps: 1 } });
    expect(zoom()).toBeCloseTo(1);
    instance.setOptions({ id, map: testMap, zoomRequest: { id: 2, steps: 1 } });
    expect(zoom()).toBeCloseTo(1.25);
    instance.setOptions({ id, map: testMap, zoomRequest: { id: 2, steps: 1 } });
    expect(zoom()).toBeCloseTo(1.25);
    instance.setOptions({
      id,
      map: testMap,
      zoomRequest: { id: 3, steps: -2 },
    });
    expect(zoom()).toBeCloseTo(0.8);
  });

  it("zoom on a mouse wheel's notch, and not on a trackpad's scroll", () => {
    const instance = mapEditor({ id, map: testMap });
    const zoom = () => instance.api.viewport.get().zoom;
    instance.api.wheel(scroll({ deltaY: 100, wheelDeltaY: -120 }));
    expect(zoom()).toBeCloseTo(0.8);
    instance.api.wheel(
      scroll({ deltaY: 4, wheelDeltaY: -12, timeStamp: 1000 }),
    );
    expect(zoom()).toBeCloseTo(0.8);
  });

  it("leave - and = to the zoom shortcuts", () => {
    const instance = mapEditor({ id, map: testMap });
    instance.api.keydown(press("-"));
    instance.api.keydown(press("="));
    expect(instance.api.viewport.get().zoom).toBe(1);
    instance.api.viewport.zoomTo(2);
    instance.api.keydown(press("0"));
    expect(instance.api.viewport.get().zoom).toBe(1);
  });

  it("put a thing under the camera above it wherever things take clicks", () => {
    const onThing = (
      editMode: "vertices" | "lines" | "sectors" | "things",
      at = { x: 96, y: 160 },
      zoom = 1,
    ) => {
      const camera = new SceneCamera(testMap);
      camera.moveTo(testMap, at);
      const instance = mapEditor({ id, map: testMap, camera, editMode });
      instance.api.viewport.zoomTo(zoom);
      return (
        partAttrs(instance.part("camera", {}))["data-on-thing"] !== undefined
      );
    };
    expect(onThing("things")).toBe(true);
    expect(onThing("vertices")).toBe(true);
    expect(onThing("lines")).toBe(false);
    expect(onThing("sectors")).toBe(false);
    expect(onThing("things", { x: 104, y: 160 })).toBe(true);
    expect(onThing("things", { x: 104, y: 160 }, 4)).toBe(false);
    expect(onThing("things", { x: 136, y: 160 })).toBe(false);
  });

  it("clear the selection with Escape", () => {
    let picked: string[] | null = null;
    const instance = mapEditor({
      id,
      map: testMap,
      selection: ["v1", "thing:imp-1"],
      onSelectionChange: (next) => {
        picked = next;
      },
    });
    instance.api.keydown(press("Escape"));
    expect(picked).toEqual([]);
  });

  it("show a wall picked as one of several", () => {
    const instance = mapEditor({ id, map: testMap, editMode: "lines" });
    const parts = listen(instance);
    instance.setOptions({
      id,
      map: testMap,
      editMode: "lines",
      selection: ["wall:v1|v15", "wall:v9|v10"],
    });
    expect(parts.heard()).toEqual(["wall v1|v15", "wall v9|v10"]);
  });

  it("move every selected wall's corners with the arrow keys", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "lines",
      selection: ["wall:v9|v10"],
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press("ArrowDown"));
    expect(defined(result).vertices.v9).toEqual({ x: 512, y: -56 });
    expect(defined(result).vertices.v10).toEqual({ x: 960, y: -56 });
  });

  it("wake the measure as a wall is drawn and when a wall is selected", () => {
    const instance = mapEditor({ id, map: testMap, tool: "draw" });
    let heard = 0;
    const part = instance.part("measure" as never, {} as never);
    slots.measure.selects.subscribe(
      part,
      () => {
        heard += 1;
      },
      {},
    );
    const { store } = instance.part("handle", { value: "v1" });
    store.set({ drawing: [{ x: 0, y: 0 }] });
    store.set({ cursor: { x: 64, y: 0 } });
    expect(heard).toBe(2);
    instance.setOptions({
      id,
      map: testMap,
      tool: "select",
      highlightedWall: "v9|v10",
    });
    expect(heard).toBeGreaterThan(2);
  });

  it("wake no shape for the same map rendered again", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.setOptions({ id, map: testMap });
    expect(parts.heard()).toEqual([]);
    instance.setOptions({ id, map: { ...testMap } });
    expect(parts.heard()).toEqual(["port door:sector-4", "port door:sector-4"]);
  });

  it("wake the room names when a thing moves, so they can step out of its way", () => {
    const instance = mapEditor({ id, map: testMap });
    const parts = listen(instance);
    instance.setOptions({
      id,
      map: { ...testMap, things: testMap.things.map((t) => ({ ...t })) },
    });
    expect(parts.heard()).toContain("caption sector-2");
  });
});

describe("map editor drags during a co-op edit", () => {
  it("end a drag cleanly when someone else deletes its only corner", () => {
    const instance = mapEditor({ id, map: testMap });
    const { store } = instance.part("handle", { value: "v1" });
    store.set({ moving: { keys: ["v1"], dx: 16, dy: 0 } });
    instance.setOptions({ id, map: defined(removeCorner(testMap, "v1")) });
    expect(() =>
      store.set({ moving: { keys: ["v1"], dx: 32, dy: 0 } }),
    ).not.toThrow();
    expect(store.get().moving).toBeNull();
  });

  it("carry on without a dragged corner someone else deletes", () => {
    let result = null as GameMap | null;
    let draft = null as GameMap | null;
    const options = {
      id,
      onMapChange: (next: GameMap) => {
        result = next;
      },
      onDraftMapChange: (next: GameMap | null) => {
        draft = next;
      },
    };
    const instance = mapEditor({
      ...options,
      map: testMap,
      selection: ["v1", "v15"],
    });
    const surface = dragSurface();
    instance.api.move.pointerdown(pointer(0, 0), "v15", surface.el);
    surface.move(16, 0);
    const edited = defined(removeCorner(testMap, "v1"));
    instance.setOptions({ ...options, map: edited, selection: ["v15"] });
    expect(
      instance.part("handle", { value: "v15" }).store.get().moving?.keys,
    ).toEqual(["v15"]);
    expect(defined(draft).vertices.v1).toBeUndefined();
    surface.move(32, 32);
    surface.release(32, 32);
    expect(defined(result).vertices.v1).toBeUndefined();
    expect(defined(result).vertices.v15).toEqual({
      x: edited.vertices.v15.x + 32,
      y: edited.vertices.v15.y + 32,
    });
  });

  it("end the drag of a thing someone else deletes", () => {
    let changes = 0;
    let draft = null as GameMap | null;
    const options = {
      id,
      onMapChange: () => {
        changes += 1;
      },
      onDraftMapChange: (next: GameMap | null) => {
        draft = next;
      },
    };
    const instance = mapEditor({ ...options, map: testMap });
    const surface = dragSurface();
    instance.api.move.pointerdown(pointer(0, 0), "thing:imp-1", surface.el);
    surface.move(16, 0);
    expect(draft).not.toBeNull();
    instance.setOptions({ ...options, map: removeThing(testMap, "imp-1") });
    expect(
      instance.part("handle", { value: "v15" }).store.get().moving,
    ).toBeNull();
    expect(draft).toBeNull();
    surface.move(64, 0);
    surface.release(64, 0);
    expect(changes).toBe(0);
  });

  it("show a co-op edit in the draft of a drag it leaves alone", () => {
    let draft = null as GameMap | null;
    const options = {
      id,
      onDraftMapChange: (next: GameMap | null) => {
        draft = next;
      },
    };
    const instance = mapEditor({ ...options, map: testMap });
    const surface = dragSurface();
    instance.api.move.pointerdown(pointer(0, 0), "v15", surface.el);
    surface.move(16, 0);
    instance.setOptions({ ...options, map: removeThing(testMap, "imp-1") });
    expect(defined(draft).things.some((thing) => thing.id === "imp-1")).toBe(
      false,
    );
  });
});

describe("map editor drags from inside a room", () => {
  it("move a room with what stands in it in every mode but things", () => {
    for (const editMode of ["vertices", "lines", "sectors"] as const) {
      const changes: GameMap[] = [];
      const instance = mapEditor({
        id,
        map: testMap,
        editMode,
        onMapChange: (next) => {
          changes.push(next);
        },
      });
      const surface = rootSurface(instance);
      instance.api.pointerdown(pointer(440, 140));
      surface.move(472, 140);
      surface.move(504, 172);
      surface.release(504, 172);
      expect(changes).toHaveLength(1);
      expect(changes[0].vertices.v13).toEqual({ x: 560, y: 128 });
      expect(changes[0].vertices.v1).toEqual(testMap.vertices.v1);
      expect(
        changes[0].things.find((thing) => thing.id === "shotgun-1"),
      ).toMatchObject({ x: 512, y: 192 });
    }
  });

  it("move a wall rather than its room when the press lands on it", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: (next) => {
        result = next;
      },
    });
    const surface = rootSurface(instance);
    instance.api.pointerdown(pointer(440, 100));
    surface.move(440, 116);
    surface.move(440, 132);
    surface.release(440, 132);
    expect(defined(result).vertices.v3).toEqual({ x: 384, y: 128 });
    expect(defined(result).vertices.v13).toEqual({ x: 496, y: 128 });
    expect(defined(result).vertices.v4).toEqual(testMap.vertices.v4);
  });

  it("box in from empty space, and from inside a room with Shift", () => {
    let changes = 0;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: () => {
        changes += 1;
      },
    });
    const surface = rootSurface(instance);
    const { store } = instance.part("handle", { value: "v1" });
    instance.api.pointerdown(pointer(-20, -20));
    surface.move(0, 0);
    surface.move(20, 20);
    surface.release(20, 20);
    expect(store.get().selection).toEqual(["v1"]);
    instance.api.pointerdown(pointer(440, 140, { shiftKey: true }));
    surface.move(480, 180);
    surface.move(520, 240);
    surface.release(520, 240);
    expect(changes).toBe(0);
    expect(store.get().selection).toEqual(
      expect.arrayContaining(["v1", "v14", "v8", "thing:shotgun-1"]),
    );
  });

  it("put a dragged room back on Escape, keeping the selection", () => {
    let changes = 0;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: () => {
        changes += 1;
      },
    });
    const surface = rootSurface(instance);
    const { store } = instance.part("handle", { value: "v1" });
    instance.api.pointerdown(pointer(440, 140));
    surface.move(480, 180);
    expect(store.get().moving?.keys).toContain("v13");
    surface.key("Escape");
    expect(store.get().moving).toBeNull();
    surface.release(480, 180);
    expect(changes).toBe(0);
    expect(store.get().activeSector).toBe("sector-2");
  });

  it("leave a finger to pan the map", () => {
    let changes = 0;
    const instance = mapEditor({
      id,
      map: testMap,
      onMapChange: () => {
        changes += 1;
      },
    });
    const surface = rootSurface(instance);
    const { store } = instance.part("handle", { value: "v1" });
    instance.api.pointerdown(pointer(440, 140, { pointerType: "touch" }));
    surface.move(480, 180);
    surface.release(480, 180);
    expect(changes).toBe(0);
    expect(store.get().moving).toBeNull();
  });

  it("name what a drag from the pointer would move", () => {
    const grabs: (MapGrab | null)[] = [];
    const instance = mapEditor({
      id,
      map: testMap,
      onGrabChange: (grab) => {
        grabs.push(grab);
      },
    });
    const { store } = instance.part("handle", { value: "v1" });
    const hover = (x: number, y: number, key?: string) =>
      instance.api.pointermove(
        pointer(x, y, {
          buttons: 0,
          target: {
            closest: () => (key ? { dataset: { mapKey: key } } : null),
          },
        }),
      );
    hover(440, 140);
    expect(store.get().grab).toBe("room:sector-2");
    hover(440, 100);
    hover(0, 0, "v1");
    hover(448, 160, "thing:shotgun-1");
    hover(200, 600);
    expect(store.get().grab).toBeNull();
    expect(grabs).toEqual([
      { kind: "room", key: "room:sector-2" },
      { kind: "wall", key: "wall:v13|v3" },
      { kind: "corner", key: "v1" },
      { kind: "thing", key: "thing:shotgun-1" },
      null,
    ]);
  });

  it("say a drag moves the selection when the room is one of several picked", () => {
    const grabs: (MapGrab | null)[] = [];
    const instance = mapEditor({
      id,
      map: testMap,
      editMode: "sectors",
      selection: ["room:sector-1", "room:sector-2"],
      onGrabChange: (grab) => {
        grabs.push(grab);
      },
    });
    instance.api.pointermove(pointer(440, 140, { buttons: 0 }));
    expect(grabs).toEqual([{ kind: "selection", key: "room:sector-2" }]);
  });
});

describe("map editor drawing", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draw a room with one drag of the draw tool", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "draw",
      drawShape: "rectangle",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.pointerdown(pointer(2000, 2000));
    instance.api.pointermove(pointer(2256, 2128));
    release(2256, 2128);
    expect(defined(result).sectors).toHaveLength(testMap.sectors.length + 1);
  });

  it("finish a drag of the draw tool released off the map", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "draw",
      drawShape: "rectangle",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.pointerdown(pointer(2000, 2000));
    release(2256, 2128);
    expect(defined(result).sectors).toHaveLength(testMap.sectors.length + 1);
  });

  it("leave a drag of the draw tool to its own pointer, and drop it when cancelled", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "draw",
      drawShape: "rectangle",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.pointerdown(pointer(2000, 2000));
    release(2256, 2128, "pointerup", 2);
    expect(result).toBeNull();
    release(2256, 2128, "pointercancel");
    release(2256, 2128);
    expect(result).toBeNull();
    const { store } = instance.part("handle", { value: "v1" });
    expect(store.get().drawing).toEqual([]);
  });

  it("pan rather than draw with Space held in the draw tool", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "draw",
      drawShape: "rectangle",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.keydown(press(" ", { target: undefined }));
    instance.api.pointerdown(pointer(2000, 2000));
    release(2256, 2128);
    instance.api.click(pointer(2256, 2128));
    instance.api.pointerdown(pointer(2000, 2000));
    instance.api.click(pointer(2000, 2000));
    const { store } = instance.part("handle", { value: "v1" });
    expect(result).toBeNull();
    expect(store.get().drawing).toEqual([]);
  });

  it("start a room on a click of the draw tool and finish it on the next", () => {
    let result = null as GameMap | null;
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "draw",
      drawShape: "rectangle",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.pointerdown(pointer(2000, 2000));
    release(2000, 2000);
    instance.api.click(pointer(2000, 2000));
    expect(result).toBeNull();
    instance.api.pointerdown(pointer(2256, 2128));
    instance.api.click(pointer(2256, 2128));
    expect(defined(result).sectors).toHaveLength(testMap.sectors.length + 1);
  });

  it("keep the draw tool after a room, so the next one starts on the next click", () => {
    const tools: string[] = [];
    let result = testMap;
    const options = {
      id,
      map: testMap,
      tool: "draw" as const,
      drawShape: "rectangle" as const,
      onToolChange: (tool: string) => tools.push(tool),
      onMapChange: (next: GameMap) => {
        result = next;
        instance.setOptions({ ...options, map: next });
      },
    };
    const instance = mapEditor(options);
    for (const y of [2000, 2400]) {
      instance.api.pointerdown(pointer(2000, y));
      instance.api.pointermove(pointer(2256, y + 128));
      release(2256, y + 128);
    }
    expect(result.sectors).toHaveLength(testMap.sectors.length + 2);
    expect(tools).toEqual([]);
  });

  it("drop a half-drawn room when another tool is picked", () => {
    const instance = mapEditor({ id, map: testMap, tool: "draw" });
    const { store } = instance.part("handle", { value: "v1" });
    store.set({ drawing: [{ x: 2000, y: 2000 }] });
    instance.setOptions({ id, map: testMap, tool: "select" });
    instance.setOptions({ id, map: testMap, tool: "draw" });
    expect(store.get().drawing).toEqual([]);
  });

  it.each(["select", "line"] as const)(
    "keep the corner a draw request starts from in the %s tool as the draw tool comes on",
    (from) => {
      let tool: MapTool = from;
      const options = {
        id,
        map: testMap,
        onToolChange: (next: MapTool) => {
          tool = next;
        },
      };
      const instance = mapEditor({ ...options, tool });
      const { store } = instance.part("handle", { value: "v1" });
      const drawRequest = { id: 1, point: { x: 2000, y: 2000 } };
      instance.setOptions({ ...options, tool, drawRequest });
      instance.setOptions({ ...options, tool, drawRequest });
      expect(tool).toBe("draw");
      expect(store.get().drawing).toEqual([{ x: 2000, y: 2000 }]);
    },
  );

  it("delete the room just drawn with Delete while still drawing", () => {
    let result = testMap;
    const options = {
      id,
      map: testMap,
      tool: "draw" as const,
      drawShape: "rectangle" as const,
      onMapChange: (next: GameMap) => {
        result = next;
        instance.setOptions({ ...options, map: next });
      },
      onActiveSectorChange: (sector: string | null) =>
        instance.setOptions({ ...options, map: result, activeSector: sector }),
    };
    const instance = mapEditor(options);
    instance.api.pointerdown(pointer(2000, 2000));
    instance.api.pointermove(pointer(2256, 2128));
    release(2256, 2128);
    expect(result.sectors).toHaveLength(testMap.sectors.length + 1);
    instance.api.keydown(press("Delete"));
    expect(result.sectors).toHaveLength(testMap.sectors.length);
  });

  it("drop the room being drawn on Esc, and leave the draw tool on the next", () => {
    const tools: string[] = [];
    const instance = mapEditor({
      id,
      map: testMap,
      tool: "draw",
      onToolChange: (tool) => tools.push(tool),
    });
    const { store } = instance.part("handle", { value: "v1" });
    store.set({ drawing: [{ x: 2000, y: 2000 }] });
    instance.api.keydown(press("Escape"));
    expect(store.get().drawing).toEqual([]);
    expect(tools).toEqual([]);
    instance.api.keydown(press("Escape"));
    expect(tools).toEqual(["select"]);
  });

  it("turn a placed player start down its room, away from the wall beside it", () => {
    const hall: GameMap = {
      ...testMap,
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 512, y: 0 },
        c: { x: 512, y: 64 },
        d: { x: 0, y: 64 },
      },
      sectors: [{ ...testMap.sectors[0], vertices: ["a", "b", "c", "d"] }],
      things: [],
      lines: {},
      switches: [],
    };
    let result = hall;
    const instance = mapEditor({
      id,
      map: hall,
      tool: "thing",
      thingKind: "player",
      onMapChange: (next) => {
        result = next;
      },
    });
    instance.api.click(pointer(480, 32));
    expect(result.things).toEqual([
      expect.objectContaining({ kind: "player", angle: 180 }),
    ]);
  });
});

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
  hear("caption", { value: corridor.id, corners: corridor.vertices });
  return { heard: () => heard.splice(0).toSorted() };
}

// Pointer moves reach the drag through the element's document, and wait for
// a frame that only a release flushes here.
function dragSurface() {
  const doc = Object.assign(new EventTarget(), {
    defaultView: {
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      setTimeout: () => 0,
    },
    pointerLockElement: null,
  });
  const el = Object.assign(new EventTarget(), {
    ownerDocument: doc,
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  }) as unknown as HTMLElement;
  const send = (type: string, clientX: number, clientY: number) =>
    doc.dispatchEvent(
      Object.assign(new Event(type), {
        clientX,
        clientY,
        pointerId: 1,
        pointerType: "mouse",
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  return {
    el,
    move: (x: number, y: number) => send("pointermove", x, y),
    release: (x: number, y: number) => send("pointerup", x, y),
    key: (key: string) =>
      doc.dispatchEvent(
        Object.assign(new Event("keydown"), { key, preventDefault: () => {} }),
      ),
  };
}

// The map's root, which presses on the map drag through.
function rootSurface(instance: Instance) {
  const surface = dragSurface();
  Object.assign(surface.el, {
    isConnected: true,
    focus: () => {},
    contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
  });
  instance.part("root", {}).el = surface.el;
  return surface;
}

function release(
  clientX: number,
  clientY: number,
  type = "pointerup",
  pointerId = 1,
) {
  const event = Object.assign(new Event(type), {
    clientX,
    clientY,
    pointerId,
  });
  window.dispatchEvent(event);
}

function moved(map: GameMap, corner: string, dx: number): GameMap {
  const point = map.vertices[corner];
  return {
    ...map,
    vertices: { ...map.vertices, [corner]: { x: point.x + dx, y: point.y } },
  };
}

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function scroll(input: Partial<WheelEvent> & { wheelDeltaY?: number }) {
  return {
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    timeStamp: 0,
    preventDefault: () => {},
    ...input,
  } as WheelEvent;
}

function pointer(
  clientX: number,
  clientY: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    clientX,
    clientY,
    pointerId: 1,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: "mouse",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: { closest: () => null },
    preventDefault: () => {},
    ...overrides,
  } as unknown as PointerEvent;
}

function press(key: string, keys: Partial<KeyboardEvent> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: () => {},
    ...keys,
  } as KeyboardEvent;
}
