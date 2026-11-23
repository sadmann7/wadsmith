import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

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
    }
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
});

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
