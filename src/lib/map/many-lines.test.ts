import { describe, expect, it } from "vitest";

import { freeTag, shiftRooms, updateLine, updateSector } from "./edit";
import {
  describeWalls,
  paintWalls,
  setWallsAction,
  setWallsTag,
  updateWallSides,
} from "./many-lines";
import { drawRoom } from "./reshape";
import { findChoices, findKeys } from "./similar";
import { testMap } from "./test-map";

const walls = ["v1|v15", "v5|v6"];

describe("editing several walls", () => {
  it("shows what they agree on", () => {
    const look = describeWalls(testMap, walls);
    expect(look.texture).toBe("STARTAN3");
    expect(look.action).toBe("none");
    const offset = updateWallSides(testMap, ["v1|v15"], () => ({
      offsetX: 8,
    }));
    expect(describeWalls(offset, walls).offsetX).toBeNull();
  });

  it("paints, offsets and flags them all", () => {
    const painted = paintWalls(testMap, walls, "BROWN1");
    expect(describeWalls(painted, walls).texture).toBe("BROWN1");
    const moved = updateWallSides(painted, walls, (side) => ({
      offsetY: (side.offsetY ?? 0) + 4,
    }));
    expect(describeWalls(moved, walls).offsetY).toBe(4);
  });

  it("gives them one action and one tag", () => {
    const acting = setWallsAction(testMap, walls, "floor-lower");
    expect(describeWalls(acting, walls).action).toBe("floor-lower");
    const tagged = setWallsTag(acting, walls, 5);
    expect(describeWalls(tagged, walls).tag).toBe(5);
    expect(
      describeWalls(setWallsAction(tagged, walls, null), walls).action,
    ).toBe("none");
  });
});

describe("actions on several walls", () => {
  it("keeps a wall's trigger, key and repeat when the kind changes", () => {
    const door = updateLine(testMap, "v1|v15", {
      action: {
        kind: "door-open",
        trigger: "switch",
        repeat: false,
        key: "blue",
        tag: 4,
      },
    });
    const changed = setWallsAction(door, walls, "door-open");
    expect(changed.lines?.["v1|v15"]?.action).toMatchObject({
      trigger: "switch",
      repeat: false,
      key: "blue",
      tag: 4,
    });
  });

  it("lets go of a trigger the new kind can't use on that wall", () => {
    const pressed = updateLine(testMap, "v1|v15", {
      action: { kind: "door-raise", trigger: "door", repeat: true, tag: 0 },
    });
    const changed = setWallsAction(pressed, walls, "door-open");
    expect(changed.lines?.["v1|v15"]?.action?.trigger).not.toBe("door");
  });

  it("shows a special set by number, and clears it with Nothing", () => {
    const raw = updateLine(testMap, "v1|v15", { raw: { special: 48, tag: 0 } });
    expect(describeWalls(raw, ["v1|v15"]).action).toBe("raw");
    const cleared = setWallsAction(raw, ["v1|v15"], null);
    expect(cleared.lines?.["v1|v15"]?.raw).toBeUndefined();
  });
});

describe("room numbers and tags", () => {
  it("moves each room from where it is, within the limits", () => {
    const moved = shiftRooms(testMap, ["sector-1", "sector-2"], "floor", 8);
    expect(moved.sectors[0].floor).toBe(8);
    expect(moved.sectors[1].floor).toBe(-8);
    const dark = shiftRooms(testMap, ["sector-1"], "light", -1000);
    expect(dark.sectors[0].light).toBe(0);
    // A door has no ceiling of its own.
    expect(shiftRooms(testMap, ["sector-4"], "ceiling", 8)).toBe(testMap);
  });

  it("finds the lowest tag nothing uses", () => {
    expect(freeTag(testMap)).toBe(1);
    const used = updateLine(
      updateSector(testMap, "sector-1", { tag: 1 }),
      "v1|v15",
      {
        action: { kind: "floor-lower", trigger: "walk", repeat: false, tag: 2 },
      },
    );
    expect(freeTag(used)).toBe(3);
  });
});

describe("finding and selecting", () => {
  it("lists what the map uses and selects where", () => {
    expect(findChoices(testMap, "flat").map((item) => item.value)).toContain(
      "FLAT5_4",
    );
    expect(findKeys(testMap, "flat", "FLAT5_4")).toEqual([
      "room:sector-2",
      "room:sector-4",
    ]);
    expect(findKeys(testMap, "thing", "imp")).toEqual(["thing:imp-1"]);
    expect(findKeys(testMap, "wall", "METAL")).toContain("wall:v13|v3");
    // An opening between rooms of the same heights shows no texture.
    const empty = { vertices: {}, sectors: [], things: [], switches: [] };
    const left = drawRoom(empty, square(0), {}, 1).map;
    const both = drawRoom(left, square(128), {}, 1).map;
    const opening = findKeys(both, "wall", "STARTAN3");
    expect(opening).toHaveLength(6);
    expect(findKeys(testMap, "action", "switch")).toEqual(["wall:v15|v16"]);
  });
});

function square(left: number) {
  return [
    { x: left, y: 0 },
    { x: left + 128, y: 0 },
    { x: left + 128, y: 128 },
    { x: left, y: 128 },
  ];
}
