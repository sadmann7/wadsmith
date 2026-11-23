import { describe, expect, it } from "vitest";

import { testMap } from "@/lib/map/test-map";

import type { Lump } from "./compile";

import { compileLumps } from "./compile";
import { vanillaLimits } from "./limits";

describe("vanilla limits", () => {
  it("find nothing in a small map", () => {
    expect(vanillaLimits(compileLumps(testMap))).toEqual([]);
  });

  it("count scrolling walls", () => {
    const lines = Array.from({ length: 65 }, () => line(48, 0));
    expect(ids(level({ lines }))).toEqual(["vanilla-scroll"]);
    expect(ids(level({ lines: lines.slice(1) }))).toEqual([]);
  });

  it("count the sectors one lift tag moves", () => {
    const sectors = Array.from({ length: 31 }, () => sector(0, 5));
    expect(ids(level({ lines: [line(62, 5)], sectors }))).toEqual([
      "vanilla-plats",
    ]);
    expect(
      ids(level({ lines: [line(62, 5)], sectors: sectors.slice(1) })),
    ).toEqual([]);
  });

  it("add up lifts that never stop across tags", () => {
    const sectors = [
      ...Array.from({ length: 16 }, () => sector(0, 1)),
      ...Array.from({ length: 16 }, () => sector(0, 2)),
    ];
    const lines = [line(87, 1), line(87, 2)];
    expect(ids(level({ lines, sectors }))).toEqual(["vanilla-perpetual"]);
  });

  it("add a lift's sectors to the lifts that never stop", () => {
    const sectors = [
      ...Array.from({ length: 20 }, () => sector(0, 1)),
      ...Array.from({ length: 15 }, () => sector(0, 2)),
    ];
    const lines = [line(87, 1), line(62, 2)];
    expect(ids(level({ lines, sectors }))).toEqual(["vanilla-perpetual"]);
  });

  it("add up crushers across tags", () => {
    const sectors = [
      ...Array.from({ length: 20 }, () => sector(0, 3)),
      ...Array.from({ length: 20 }, () => sector(0, 4)),
    ];
    const lines = [line(73, 3), line(6, 4)];
    expect(ids(level({ lines, sectors }))).toEqual(["vanilla-ceilings"]);
    expect(ids(level({ lines: [line(40, 3)], sectors }))).toEqual([]);
  });

  it("estimate the size of a save", () => {
    const things = Array.from({ length: 1200 }, () => thing(3001, 7));
    expect(ids(level({ things }))).toEqual(["vanilla-save"]);
    const split = [
      ...Array.from({ length: 600 }, () => thing(3001, 1)),
      ...Array.from({ length: 600 }, () => thing(3001, 4)),
    ];
    expect(ids(level({ things: split }))).toEqual([]);
    const starts = Array.from({ length: 1200 }, () => thing(1, 7));
    const coop = Array.from({ length: 1200 }, () => thing(3001, 16));
    expect(ids(level({ things: [...starts, ...coop] }))).toEqual([]);
  });
});

function ids(lumps: Lump[]) {
  return vanillaLimits(lumps).map((issue) => issue.id);
}

function level({
  lines = [],
  sectors = [],
  things = [],
}: {
  lines?: number[][];
  sectors?: number[][];
  things?: number[][];
}): Lump[] {
  return [
    { name: "LINEDEFS", data: words(lines) },
    { name: "SECTORS", data: sectorBytes(sectors) },
    { name: "THINGS", data: words(things) },
  ];
}

function line(special: number, tag: number) {
  return [0, 1, 0, special, tag, 0, -1];
}

function sector(special: number, tag: number) {
  return [special, tag];
}

function thing(type: number, flags: number) {
  return [0, 0, 0, type, flags];
}

function words(rows: number[][]) {
  const data = new Int16Array(rows.flat());
  return new Uint8Array(data.buffer);
}

function sectorBytes(rows: number[][]) {
  const data = new Uint8Array(rows.length * 26);
  const view = new DataView(data.buffer);
  rows.forEach(([special, tag], index) => {
    view.setInt16(index * 26 + 22, special, true);
    view.setInt16(index * 26 + 24, tag, true);
  });
  return data;
}
