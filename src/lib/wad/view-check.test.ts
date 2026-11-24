import { describe, expect, it } from "vitest";

import type { GameMap, Sector, Thing } from "@/lib/map/types";

import { wallKey } from "@/lib/map/geometry";
import { testMap } from "@/lib/map/test-map";

import { compileLumps } from "./compile";
import { countView, readLevel } from "./vanilla-view";
import { checkViews } from "./view-check";

describe("vanilla views", () => {
  it("fill a floor and a ceiling looking around one room", () => {
    const map = grid(1, 512, () => 0);
    const level = readLevel(compileLumps(map));
    for (const angle of [0, 0x20000000, 0x40000000, 0xc0000000]) {
      const counts = countView(level, 256, -256, 0, angle);
      expect(counts.visplanes).toBe(2);
      expect(counts.drawsegs).toBeGreaterThan(0);
      expect(counts.solidsegs).toBeLessThanOrEqual(3);
      expect(counts.openings).toBe(0);
      expect(counts.vissprites).toBe(0);
    }
  });

  it("count the sprites in front of the view on the busiest skill", () => {
    const map = grid(1, 512, () => 0);
    map.things = [
      ...Array.from({ length: 6 }, (_, i) =>
        bonus(`ahead-${i}`, 128 + i * 48, 64),
      ),
      bonus("behind", 256, 480),
      { ...bonus("easy", 256, 96), skills: ["easy" as const] },
      { ...bonus("coop", 288, 96), multiplayer: true },
    ];
    const level = readLevel(compileLumps(map));
    expect(countView(level, 256, -256, 0, 0x40000000).vissprites).toBe(7);
    expect(countView(level, 256, -256, 0, 0xc0000000).vissprites).toBe(1);
  });

  it("keep counting the walls a view wants past the drawseg table", () => {
    const map = grid(
      30,
      64,
      (column, row) => ((column * 7 + row * 3) % 40) - 20,
    );
    const level = readLevel(compileLumps(map));
    const counts = countView(level, 32, -32, -20, 0xe0000000);
    expect(counts.drawsegs).toBeGreaterThan(300);
  });

  it("find nothing in a small map", () => {
    expect(checkViews(testMap, compileLumps(testMap))).toEqual([]);
  });

  it("find a room whose view has too many floors in it", () => {
    const map = grid(14, 48, (column, row) => ((column * 14 + row) % 24) - 12);
    const issues = checkViews(map, compileLumps(map));
    const visplanes = issues.find((issue) =>
      issue.id.startsWith("vanilla-visplanes:"),
    );
    expect(visplanes?.target).toMatch(/^cell-/);
    expect(visplanes?.view).toBeDefined();
    expect(visplanes?.detail).toMatch(/of 128 facing/);
  });

  it("find a view through too many see-through walls", () => {
    const map = grates(28);
    const level = readLevel(compileLumps(map));
    const counts = countView(level, 2048, -2016, 0, 0x40000000);
    expect(counts.openings).toBe(28 * 320 * 3);
    expect(counts.visplanes).toBe(2);
    const issues = checkViews(map, compileLumps(map));
    expect(issues.map((issue) => issue.id)).toEqual(["vanilla-openings:hall"]);
    expect(issues[0].detail).toMatch(/^Hall: 26880 of 20480 facing/);
  });

  it("find sprites seen together only between the eight directions", () => {
    const map = crowd(70);
    const level = readLevel(compileLumps(map));
    for (let direction = 0; direction < 8; direction += 1) {
      const angle = (direction * 0x20000000) >>> 0;
      expect(countView(level, 16, -16, 0, angle).vissprites).toBeLessThan(128);
    }
    const issues = checkViews(map, compileLumps(map));
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("vanilla-vissprites:alcove");
    expect(issues[0].detail).toMatch(/^Alcove: 140 of 128 facing/);
  });
});

function bonus(id: string, x: number, y: number): Thing {
  return { id, kind: "health-bonus", x, y, angle: 0 };
}

// One wide hall crossed by rows of grates, seen end on.
function grates(rows: number): GameMap {
  const vertices: GameMap["vertices"] = {
    a: { x: 0, y: 0 },
    b: { x: 4096, y: 0 },
    c: { x: 4096, y: 2048 },
    d: { x: 0, y: 2048 },
  };
  const details: string[][] = [];
  const sides: NonNullable<GameMap["lines"]> = {};
  for (let row = 0; row < rows; row += 1) {
    const y = 64 + row * 64;
    vertices[`l${row}`] = { x: 8, y };
    vertices[`r${row}`] = { x: 4088, y };
    details.push([`l${row}`, `r${row}`]);
    sides[wallKey(`l${row}`, `r${row}`)] = {
      sides: { hall: { middle: "MIDGRATE" } },
    };
  }
  return {
    vertices,
    sectors: [{ ...room("hall", ["a", "b", "c", "d"], 256), details }],
    things: [],
    switches: [],
    lines: sides,
  };
}

// A one-spot alcove open to a low hall, with two piles of things in the hall
// 80 degrees apart as the alcove sees them.
function crowd(each: number): GameMap {
  const pile = (name: string, degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    const x = Math.round(16 + 800 * Math.cos(radians));
    const y = Math.round(16 - 800 * Math.sin(radians));
    return Array.from({ length: each }, (_, i) => bonus(`${name}-${i}`, x, y));
  };
  return {
    vertices: {
      a: { x: 0, y: 0 },
      b: { x: 64, y: 0 },
      c: { x: 64, y: 64 },
      d: { x: 0, y: 64 },
      e: { x: -2000, y: 0 },
      f: { x: -2000, y: -2000 },
      g: { x: 2064, y: -2000 },
      h: { x: 2064, y: 0 },
    },
    sectors: [
      room("alcove", ["a", "b", "c", "d"], 128),
      room("hall", ["e", "f", "g", "h", "b", "a"], 40),
    ],
    things: [...pile("right", 70), ...pile("left", 150)],
    switches: [],
  };
}

function grid(
  size: number,
  cell: number,
  floorOf: (column: number, row: number) => number,
): GameMap {
  const vertices: GameMap["vertices"] = {};
  for (let row = 0; row <= size; row += 1) {
    for (let column = 0; column <= size; column += 1) {
      vertices[`v${column}-${row}`] = { x: column * cell, y: row * cell };
    }
  }
  const sectors = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      sectors.push({
        ...testMap.sectors[0],
        id: `cell-${column}-${row}`,
        name: `Cell ${column}, ${row}`,
        vertices: [
          `v${column}-${row}`,
          `v${column + 1}-${row}`,
          `v${column + 1}-${row + 1}`,
          `v${column}-${row + 1}`,
        ],
        floor: floorOf(column, row),
        ceiling: 256,
        light: 96 + ((column + row) % 8) * 16,
      });
    }
  }
  return { vertices, sectors, things: [], switches: [] };
}

function room(id: string, vertices: string[], ceiling: number): Sector {
  return {
    ...testMap.sectors[0],
    id,
    name: id[0].toUpperCase() + id.slice(1),
    vertices,
    floor: 0,
    ceiling,
  };
}
