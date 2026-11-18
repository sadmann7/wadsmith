import { describe, expect, it } from "vitest";

import {
  addRoomOnSide,
  addSwitchInRoom,
  setRoomDoor,
  wallNear,
  updateSector,
} from "../map/edit";
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
  switches: [],
};

function updateSectorCeiling(map: GameMap, id: string, ceiling: number) {
  return {
    ...map,
    sectors: map.sectors.map((sector) =>
      sector.id === id ? { ...sector, ceiling } : sector,
    ),
  };
}

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

function linesOf(map: GameMap) {
  const { lines } = buildLevel(map);
  const view = new DataView(lump(map, "LINEDEFS").buffer);
  return lines.map((line, index) => ({
    line,
    flags: view.getInt16(index * 14 + 4, true),
    special: view.getInt16(index * 14 + 6, true),
    tag: view.getInt16(index * 14 + 8, true),
  }));
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
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(3);
    const linedefs = new DataView(lump(starterMap, "LINEDEFS").buffer);
    const flags = lines.map((_, index) =>
      linedefs.getInt16(index * 14 + 4, true),
    );
    expect(flags.filter((flag) => flag === 4)).toHaveLength(3);
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

  it("rejects heights the engine can't store", () => {
    const issues = validateMap(
      updateSectorCeiling(starterMap, "sector-1", 40000),
    );
    expect(issues.map((issue) => issue.id)).toContain("height-range:sector-1");
  });

  it("rejects a room too tall for the engine", () => {
    const map = updateSector(starterMap, "sector-1", {
      floor: -16384,
      ceiling: 16384,
    });
    expect(validateMap(map).map((issue) => issue.id)).toContain(
      "height-range:sector-1",
    );
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
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(4);
  });

  it("requires a wired switch for a switch door", () => {
    const issues = validateMap({ ...starterMap, switches: [] });
    expect(issues.map((issue) => issue.id)).toContain("door-unwired:sector-4");
  });

  it("rejects a door the player can't fit through", () => {
    const low = updateSectorCeiling(starterMap, "sector-2", 32);
    expect(validateMap(low).map((issue) => issue.id)).toContain(
      "door-low:sector-4",
    );
  });

  it("rejects a switch on a wall that became an opening", () => {
    const item = starterMap.switches[0];
    const issues = validateMap({
      ...starterMap,
      switches: [{ ...item, from: "v3", to: "v4" }],
    });
    expect(issues.map((issue) => issue.id)).toContain("switch-open:switch-1");
  });
});

describe("wallNear", () => {
  it("picks the side of a shared wall under the pointer", () => {
    const wall = "v3|v4";
    expect(wallNear(starterMap, { x: 378, y: 160 }, 14)).toEqual({
      sector: "sector-1",
      wall,
    });
    expect(wallNear(starterMap, { x: 390, y: 160 }, 14)).toEqual({
      sector: "sector-2",
      wall,
    });
  });

  it("handles a diagonal shared wall", () => {
    const map: GameMap = {
      ...lShape,
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 96, y: 128 },
        c: { x: 0, y: 128 },
        d: { x: 96, y: 0 },
      },
      sectors: [
        { ...lShape.sectors[0], id: "left", vertices: ["a", "b", "c"] },
        { ...lShape.sectors[0], id: "right", vertices: ["a", "d", "b"] },
      ],
    };
    for (let step = 8; step < 120; step += 7) {
      const onWall = { x: (step * 96) / 128, y: step };
      expect(
        wallNear(map, { x: onWall.x - 3, y: onWall.y + 3 }, 14)?.sector,
      ).toBe("left");
      expect(
        wallNear(map, { x: onWall.x + 3, y: onWall.y - 3 }, 14)?.sector,
      ).toBe("right");
    }
  });

  it("ignores walls out of reach", () => {
    expect(wallNear(starterMap, { x: 190, y: 160 }, 14)).toBeNull();
  });
});

describe("doors and switches", () => {
  const doorIndex = starterMap.sectors.findIndex((item) => item.door);
  const door = starterMap.sectors[doorIndex].door!;

  it("starts a door closed and tags it for its switch", () => {
    const sectors = new DataView(lump(starterMap, "SECTORS").buffer);
    const offset = doorIndex * 26;
    expect(sectors.getInt16(offset + 2, true)).toBe(
      sectors.getInt16(offset, true),
    );
    expect(sectors.getInt16(offset + 24, true)).toBe(doorIndex + 1);
  });

  it("keeps the door behind every line that opens onto it", () => {
    const facing = buildLevel(starterMap).lines.filter(
      (line) => line.frontSector === doorIndex || line.backSector === doorIndex,
    );
    const shared = facing.filter((line) => line.backSector !== null);
    expect(shared).toHaveLength(2);
    expect(shared.every((line) => line.backSector === doorIndex)).toBe(true);
  });

  it("links a switch to its door", () => {
    const wired = linesOf(starterMap).filter((item) => item.special !== 0);
    expect(wired).toHaveLength(1);
    expect(wired[0].special).toBe(61);
    expect(wired[0].tag).toBe(doorIndex + 1);
    expect(wired[0].line.backSector).toBeNull();
  });

  it("uses the repeating special for a door that closes", () => {
    const map = setRoomDoor(starterMap, "sector-4", { ...door, closes: true });
    expect(linesOf(map).find((item) => item.special)?.special).toBe(63);
  });

  it("puts use specials on both faces of a use door", () => {
    const map = setRoomDoor(starterMap, "sector-4", {
      ...door,
      opensBy: "use",
      closes: true,
    });
    const used = linesOf({ ...map, switches: [] }).filter(
      (item) => item.special === 1,
    );
    expect(used).toHaveLength(2);
  });

  it("cuts a short section out of a long wall for a switch", () => {
    const added = addSwitchInRoom(starterMap, "sector-3", "sector-4");
    expect(added).not.toBeNull();
    const item = added!.map.switches.at(-1)!;
    const a = added!.map.vertices[item.from];
    const b = added!.map.vertices[item.to];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBe(64);
    expect(validateMap(added!.map)).toEqual([]);
  });

  it("disconnects switches when a door becomes a room again", () => {
    const map = setRoomDoor(starterMap, "sector-4", undefined);
    expect(map.switches[0].door).toBeNull();
  });
});
