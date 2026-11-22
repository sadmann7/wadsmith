import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import { updateLine, updateLineSide, updateSector } from "./edit";
import { wallKey } from "./geometry";
import {
  applyLook,
  floodWalls,
  getCanTakeLook,
  gradient,
  gradientEnds,
  lookOf,
} from "./look";
import { moveSurfaceHeight } from "./surfaces";
import { testMap } from "./test-map";

const solid = wallKey("v1", "v15");
const far = wallKey("v5", "v6");
const wall = (sector: string, key: string, part = "middle") =>
  `wall:${sector}:${key}:${part}`;

describe("a surface's look", () => {
  it("copies a wall's texture, offsets and pegging onto another wall", () => {
    const source = updateLine(
      updateLineSide(testMap, solid, "sector-1", { offsetX: 8, offsetY: 4 }),
      solid,
      { lowerFixed: true },
    );
    const look = defined(lookOf(source, wall("sector-1", solid)));
    expect(look).toEqual({
      kind: "wall",
      texture: "STARTAN3",
      offsetX: 8,
      offsetY: 4,
      upperFixed: false,
      lowerFixed: true,
    });
    const pasted = applyLook(
      updateSector(source, "sector-3", { wallTexture: "BROWN1" }),
      wall("sector-3", wallKey("v9", "v10")),
      look,
    );
    const target = wallKey("v9", "v10");
    expect(pasted.sectors[2].wallOverrides).toEqual({ [target]: "STARTAN3" });
    expect(pasted.lines?.[target]).toEqual({
      lowerFixed: true,
      sides: { "sector-3": { offsetX: 8, offsetY: 4 } },
    });
    // A wall that already wears the look stays as it is, with no new map.
    expect(applyLook(pasted, wall("sector-3", target), look)).toBe(pasted);
    // A plain wall's look takes the offsets and pegging off again.
    const plain = defined(lookOf(testMap, wall("sector-1", far)));
    const cleared = applyLook(pasted, wall("sector-3", target), plain);
    expect(cleared.lines?.[target]).toBeUndefined();
  });

  it("changes only the texture when the look holds nothing else", () => {
    const source = updateLine(
      updateLineSide(testMap, solid, "sector-1", { offsetX: 8, offsetY: 4 }),
      solid,
      { upperFixed: true, lowerFixed: true },
    );
    const key = wall("sector-1", solid);
    const painted = applyLook(source, key, { kind: "wall", texture: "BRICK1" });
    expect(painted.sectors[0].wallOverrides).toEqual({ [solid]: "BRICK1" });
    expect(painted.lines?.[solid]).toEqual(source.lines?.[solid]);
    expect(getCanTakeLook(source, key, { kind: "wall", texture: "X" })).toBe(
      true,
    );
    expect(getCanTakeLook(source, key, { kind: "flat", texture: "X" })).toBe(
      false,
    );
    expect(
      getCanTakeLook(source, "thing:imp-1", { kind: "wall", texture: "X" }),
    ).toBe(false);
  });

  it("copies a flat between floors and ceilings and keeps kinds apart", () => {
    const look = defined(lookOf(testMap, "floor:sector-1"));
    expect(look).toEqual({ kind: "flat", texture: "FLOOR4_8" });
    expect(
      applyLook(testMap, "ceiling:sector-3", look).sectors[2],
    ).toMatchObject({ ceilingTexture: "FLOOR4_8" });
    expect(applyLook(testMap, wall("sector-1", solid), look)).toBe(testMap);
    const brick = defined(lookOf(testMap, wall("sector-1", solid)));
    expect(applyLook(testMap, "floor:sector-1", brick)).toBe(testMap);
    expect(lookOf(testMap, "thing:imp-1")).toBeNull();
    // A door's face and a switch keep their own art.
    expect(
      lookOf(testMap, wall("sector-2", wallKey("v13", "v14"), "upper")),
    ).toBeNull();
  });

  it("floods a texture along joined walls that show the old one", () => {
    const flooded = floodWalls(testMap, wall("sector-1", far), "BRICK1");
    const start = flooded.sectors[0];
    // Every plain wall of the start room is joined corner to corner.
    expect(start.wallOverrides?.[far]).toBe("BRICK1");
    expect(start.wallOverrides?.[solid]).toBe("BRICK1");
    // The corridor wears another texture, so the flood stops at it.
    expect(flooded.sectors[1].wallOverrides).toBeUndefined();
    expect(flooded.sectors[1].wallTexture).toBe("METAL");
    expect(floodWalls(testMap, wall("sector-1", far), "STARTAN3")).toBe(
      testMap,
    );
    expect(floodWalls(testMap, "floor:sector-1", "BRICK1")).toBe(testMap);
  });

  it("spreads heights and brightness from the first surface to the last", () => {
    const keys = ["floor:sector-1", "floor:sector-2", "floor:sector-3"];
    const stepped = gradient(testMap, keys, "height", 0, 64);
    expect(stepped.sectors.slice(0, 3).map((sector) => sector.floor)).toEqual([
      0, 32, 64,
    ]);
    const lit = gradient(testMap, keys, "light", 96, 300);
    expect(lit.sectors.slice(0, 3).map((sector) => sector.light)).toEqual([
      96, 198, 255,
    ]);
    // A floor stops short of its ceiling.
    const high = gradient(testMap, ["floor:sector-2"], "height", 500, 500);
    expect(high.sectors[1].floor).toBe(88);
    expect(gradient(testMap, [wall("sector-1", solid)], "height", 8, 8)).toBe(
      testMap,
    );
  });

  it("steps a gradient over the surfaces that take it and no others", () => {
    // A wall picked first takes no height, so the floors still run 0 to 60.
    const keys = [
      wall("sector-1", solid),
      "floor:sector-1",
      "floor:sector-2",
      "floor:sector-3",
    ];
    const stepped = gradient(testMap, keys, "height", 0, 60);
    expect(stepped.sectors.slice(0, 3).map((sector) => sector.floor)).toEqual([
      0, 30, 60,
    ]);
    expect(gradientEnds(stepped, keys, "height")).toEqual([0, 60]);
    expect(gradientEnds(testMap, [wall("sector-1", solid)], "height")).toBe(
      null,
    );
    // Two surfaces of one room count once for brightness.
    const rooms = ["floor:sector-1", "ceiling:sector-1", "floor:sector-3"];
    const lit = gradient(testMap, rooms, "light", 100, 200);
    expect(lit.sectors[0].light).toBe(100);
    expect(lit.sectors[2].light).toBe(200);
    expect(gradientEnds(lit, rooms, "light")).toEqual([100, 200]);
    // The same gradient again changes nothing, so no new map comes back.
    expect(gradient(lit, rooms, "light", 100, 200)).toBe(lit);
    expect(gradient(stepped, keys, "height", 0, 60)).toBe(stepped);
  });

  it("returns the same map when a height is already at its limit", () => {
    const low = moveSurfaceHeight(testMap, "ceiling:sector-1", -4096);
    expect(low).not.toBe(testMap);
    expect(moveSurfaceHeight(low, "ceiling:sector-1", -8)).toBe(low);
    expect(moveSurfaceHeight(low, "floor:sector-1", 8)).toBe(low);
  });
});
