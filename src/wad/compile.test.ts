import { describe, expect, it } from "vitest";

import { addRoomOnSide } from "../map/edit";
import { starterMap } from "../map/starter-map";
import type { GameMap } from "../map/types";
import { validateMap } from "../map/validate";
import { buildLevel, compileLumps, compileMap } from "./compile";
import { buildNodes, subsectorFlag } from "./nodes";

const lShape: GameMap = {
  vertices: {
    a: { x: 0, y: 0 },
    b: { x: 256, y: 0 },
    c: { x: 256, y: 128 },
    d: { x: 128, y: 128 },
    e: { x: 128, y: 256 },
    f: { x: 0, y: 256 },
  },
  sectors: [
    { ...starterMap.sectors[0], vertices: ["a", "b", "c", "d", "e", "f"] },
  ],
  things: [{ id: "player-1", kind: "player", x: 64, y: 64, angle: 0 }],
};

function lump(map: GameMap, name: string) {
  const found = compileLumps(map).find((item) => item.name === name);
  if (!found) throw new Error(`Missing ${name}.`);
  return found.data;
}

function expectConvexLeaves(map: GameMap) {
  const { vertices, lines } = buildLevel(map);
  const bsp = buildNodes(vertices, lines);
  for (const subsector of bsp.subsectors) {
    const segs = bsp.segs.slice(
      subsector.first,
      subsector.first + subsector.count,
    );
    expect(new Set(segs.map((seg) => seg.sector)).size).toBe(1);
    for (const seg of segs) {
      const start = bsp.vertices[seg.start];
      const end = bsp.vertices[seg.end];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      for (const other of segs) {
        for (const index of [other.start, other.end]) {
          const point = bsp.vertices[index];
          const side =
            ((end.x - start.x) * (point.y - start.y) -
              (end.y - start.y) * (point.x - start.x)) /
            length;
          expect(side).toBeLessThanOrEqual(1);
        }
      }
    }
  }
  return bsp;
}

describe("compileMap", () => {
  it("writes a patch WAD with every map lump in engine order", () => {
    const wad = compileMap(starterMap);
    const view = new DataView(wad.buffer);
    expect(String.fromCharCode(...wad.slice(0, 4))).toBe("PWAD");
    expect(view.getInt32(4, true)).toBe(11);
    const names = Array.from({ length: 11 }, (_, index) => {
      const start = view.getInt32(8, true) + index * 16 + 8;
      return String.fromCharCode(...wad.slice(start, start + 8)).replace(
        /\0+$/,
        "",
      );
    });
    expect(names).toEqual([
      "MAP01",
      "THINGS",
      "LINEDEFS",
      "SIDEDEFS",
      "VERTEXES",
      "SEGS",
      "SSECTORS",
      "NODES",
      "SECTORS",
      "REJECT",
      "BLOCKMAP",
    ]);
  });

  it("turns shared walls into two-sided lines", () => {
    const { lines } = buildLevel(starterMap);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(2);
    const linedefs = new DataView(lump(starterMap, "LINEDEFS").buffer);
    const flags = lines.map((_, index) =>
      linedefs.getInt16(index * 14 + 4, true),
    );
    expect(flags.filter((flag) => flag === 4)).toHaveLength(2);
  });

  it("gives rooms clockwise fronts in the engine's y-up space", () => {
    const { vertices, lines } = buildLevel(lShape);
    let doubledArea = 0;
    for (const line of lines) {
      const a = vertices[line.start];
      const b = vertices[line.end];
      doubledArea += a.x * b.y - b.x * a.y;
    }
    expect(doubledArea).toBeLessThan(0);
  });

  it("splits a concave room into convex leaves", () => {
    const bsp = expectConvexLeaves(lShape);
    expect(bsp.nodes.length).toBeGreaterThan(0);
    expect(bsp.nodes.at(-1)!.rightChild).toBeDefined();
  });

  it("keeps a convex room as a single leaf", () => {
    const square: GameMap = {
      ...lShape,
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 128, y: 0 },
        c: { x: 128, y: 128 },
        d: { x: 0, y: 128 },
      },
      sectors: [{ ...lShape.sectors[0], vertices: ["a", "b", "c", "d"] }],
    };
    const bsp = expectConvexLeaves(square);
    expect(bsp.nodes).toHaveLength(0);
    expect(bsp.subsectors).toHaveLength(1);
  });

  it("builds convex leaves for connected rooms", () => {
    const bsp = expectConvexLeaves(starterMap);
    const children = bsp.nodes.flatMap((node) => [
      node.rightChild,
      node.leftChild,
    ]);
    const leaves = children.filter((child) => child & subsectorFlag);
    expect(leaves).toHaveLength(bsp.subsectors.length);
  });

  it("indexes every wall in the blockmap", () => {
    const words = new Int16Array(lump(starterMap, "BLOCKMAP").slice().buffer);
    const cells = words[2] * words[3];
    const found = new Set<number>();
    for (let cell = 0; cell < cells; cell += 1) {
      let cursor = words[4 + cell];
      expect(words[cursor]).toBe(0);
      cursor += 1;
      while (words[cursor] !== -1) {
        found.add(words[cursor]);
        cursor += 1;
      }
    }
    expect(found.size).toBe(buildLevel(starterMap).lines.length);
  });
});

describe("validateMap", () => {
  it("accepts the starter map", () => {
    expect(validateMap(starterMap)).toEqual([]);
  });

  it("requires a player start", () => {
    const issues = validateMap({ ...starterMap, things: [] });
    expect(issues.map((issue) => issue.id)).toContain("no-player");
  });

  it("rejects things outside every room", () => {
    const issues = validateMap({
      ...starterMap,
      things: [
        ...starterMap.things,
        { id: "imp-2", kind: "imp", x: 5000, y: 5000, angle: 0 },
      ],
    });
    expect(issues.map((issue) => issue.id)).toContain("outside:imp-2");
  });

  it("rejects a twisted room", () => {
    const issues = validateMap({
      ...starterMap,
      vertices: { ...starterMap.vertices, v1: { x: 300, y: 500 } },
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("keeps a room added to a free wall valid and connected", () => {
    const added = addRoomOnSide(starterMap, "sector-1", "west", 128);
    expect(added).not.toBeNull();
    expect(validateMap(added!.map)).toEqual([]);
    const { lines } = buildLevel(added!.map);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(3);
  });
});
