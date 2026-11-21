import { describe, expect, it } from "vitest";

import {
  addPlayerStarts,
  addRoomOnSide,
  addSwitch,
  addThing,
  addSwitchInRoom,
  changeThings,
  connectedCorners,
  duplicateThings,
  faceThings,
  freeWallAt,
  freeWallNear,
  removeSector,
  removeThings,
  setLineTarget,
  snapCorners,
  setRoomDoor,
  updateLine,
  updateLineSide,
  wallNear,
  updateSector,
  updateThing,
  updateThings,
} from "../map/edit";
import {
  canStand,
  targetExists,
  targetForIssue,
  targetForKeys,
  targetForSurface,
  viewOfTarget,
  wallTarget,
} from "../editor/map-target";
import { sectorAt, wallKey } from "../map/geometry";
import {
  fitLineAction,
  lineActionGroups,
  lineActionKinds,
  lineActions,
  newLineAction,
  triggersFor,
} from "../map/lines";
import { mapBalance } from "../map/balance";
import {
  ceilingTextures,
  floorTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
} from "../map/catalog";
import { buildChecks, checkMap, fixIssue, issueText } from "../map/checks";
import { wadFileName } from "../editor/build-dialog";
import { freedoomFlats, freedoomWalls } from "../map/freedoom-textures";
import { wallUse } from "../map/textures";
import { testMap } from "../map/test-map";
import { parseMapFile, serializeMap } from "../map/storage";
import type { GameMap, LineAction } from "../map/types";
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
    { ...testMap.sectors[0], vertices: ["a", "b", "c", "d", "e", "f"] },
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
    const wad = compileMap(testMap);
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
    const { lines } = buildLevel(testMap);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(3);
    const linedefs = new DataView(lump(testMap, "LINEDEFS").buffer);
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
    const bsp = expectConvexLeaves(testMap);
    const children = bsp.nodes.flatMap((node) => [
      node.rightChild,
      node.leftChild,
    ]);
    const leaves = children.filter((child) => child & subsectorFlag);
    expect(leaves).toHaveLength(bsp.subsectors.length);
  });

  it("indexes every wall in the blockmap", () => {
    const words = new Int16Array(lump(testMap, "BLOCKMAP").slice().buffer);
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
    expect(found.size).toBe(buildLevel(testMap).lines.length);
  });
});

describe("validateMap", () => {
  it("accepts the starter map", () => {
    expect(validateMap(testMap)).toEqual([]);
  });

  it("requires a player start", () => {
    const issues = validateMap({ ...testMap, things: [] });
    expect(issues.map((issue) => issue.id)).toContain("no-player");
  });

  it("rejects things outside every room", () => {
    const issues = validateMap({
      ...testMap,
      things: [
        ...testMap.things,
        { id: "imp-2", kind: "imp", x: 5000, y: 5000, angle: 0 },
      ],
    });
    expect(issues.map((issue) => issue.id)).toContain("outside:imp-2");
  });

  it("rejects heights the engine can't store", () => {
    const issues = validateMap(updateSectorCeiling(testMap, "sector-1", 40000));
    expect(issues.map((issue) => issue.id)).toContain("height-range:sector-1");
  });

  it("rejects a room too tall for the engine", () => {
    const map = updateSector(testMap, "sector-1", {
      floor: -16384,
      ceiling: 16384,
    });
    expect(validateMap(map).map((issue) => issue.id)).toContain(
      "height-range:sector-1",
    );
  });

  it("rejects a twisted room", () => {
    const issues = validateMap({
      ...testMap,
      vertices: { ...testMap.vertices, v1: { x: 300, y: 500 } },
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("keeps a room added to a free wall valid and connected", () => {
    const added = addRoomOnSide(testMap, "sector-1", "west", 128);
    expect(added).not.toBeNull();
    expect(validateMap(added!.map)).toEqual([]);
    const { lines } = buildLevel(added!.map);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(4);
  });

  it("requires a wired switch for a switch door", () => {
    const issues = validateMap({ ...testMap, switches: [] });
    expect(issues.map((issue) => issue.id)).toContain("door-unwired:sector-4");
  });

  it("warns about a door the player can't fit through", () => {
    const low = updateSectorCeiling(testMap, "sector-2", 32);
    expect(validateMap(low)).toEqual([]);
    expect(checkMap(low)).toContainEqual(
      expect.objectContaining({ id: "door-low:sector-4", severity: "warning" }),
    );
  });

  it("rejects a switch on a wall that became an opening", () => {
    const item = testMap.switches[0];
    const issues = validateMap({
      ...testMap,
      switches: [{ ...item, from: "v3", to: "v4" }],
    });
    expect(issues.map((issue) => issue.id)).toContain("switch-open:switch-1");
  });
});

describe("wallNear", () => {
  it("picks the side of a shared wall under the pointer", () => {
    const wall = "v3|v4";
    expect(wallNear(testMap, { x: 378, y: 160 }, 14)).toEqual({
      sector: "sector-1",
      wall,
    });
    expect(wallNear(testMap, { x: 390, y: 160 }, 14)).toEqual({
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
    expect(wallNear(testMap, { x: 190, y: 160 }, 14)).toBeNull();
  });
});

describe("doors and switches", () => {
  const doorIndex = testMap.sectors.findIndex((item) => item.door);
  const door = testMap.sectors[doorIndex].door!;

  it("starts a door closed and tags it for its switch", () => {
    const sectors = new DataView(lump(testMap, "SECTORS").buffer);
    const offset = doorIndex * 26;
    expect(sectors.getInt16(offset + 2, true)).toBe(
      sectors.getInt16(offset, true),
    );
    expect(sectors.getInt16(offset + 24, true)).toBe(doorIndex + 1);
  });

  it("keeps the door behind every line that opens onto it", () => {
    const facing = buildLevel(testMap).lines.filter(
      (line) => line.frontSector === doorIndex || line.backSector === doorIndex,
    );
    const shared = facing.filter((line) => line.backSector !== null);
    expect(shared).toHaveLength(2);
    expect(shared.every((line) => line.backSector === doorIndex)).toBe(true);
  });

  it("links a switch to its door", () => {
    const wired = linesOf(testMap).filter((item) => item.special !== 0);
    expect(wired).toHaveLength(1);
    expect(wired[0].special).toBe(61);
    expect(wired[0].tag).toBe(doorIndex + 1);
    expect(wired[0].line.backSector).toBeNull();
  });

  it("uses the repeating special for a door that closes", () => {
    const map = setRoomDoor(testMap, "sector-4", { ...door, closes: true });
    expect(linesOf(map).find((item) => item.special)?.special).toBe(63);
  });

  it("puts use specials on both faces of a use door", () => {
    const map = setRoomDoor(testMap, "sector-4", {
      ...door,
      opensBy: "use",
      closes: true,
    });
    const used = linesOf({ ...map, switches: [] }).filter(
      (item) => item.special === 1,
    );
    expect(used).toHaveLength(2);
  });

  it("uses the fast specials for a fast door", () => {
    const special = (settings: Partial<typeof door>) => {
      const map = setRoomDoor(testMap, "sector-4", { ...door, ...settings });
      return linesOf(
        settings.opensBy === "use" ? { ...map, switches: [] } : map,
      )
        .map((item) => item.special)
        .filter(Boolean);
    };
    expect(special({ fast: true })).toEqual([115]);
    expect(special({ fast: true, closes: true })).toEqual([114]);
    expect(special({ fast: true, opensBy: "use" })).toEqual([118, 118]);
    expect(special({ fast: true, opensBy: "use", closes: true })).toEqual([
      117, 117,
    ]);
  });

  it("cuts a short section out of a long wall for a switch", () => {
    const added = addSwitchInRoom(testMap, "sector-3", "sector-4");
    expect(added).not.toBeNull();
    const item = added!.map.switches.at(-1)!;
    const a = added!.map.vertices[item.from];
    const b = added!.map.vertices[item.to];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBe(64);
    expect(validateMap(added!.map)).toEqual([]);
  });

  it("disconnects switches when a door becomes a room again", () => {
    const map = setRoomDoor(testMap, "sector-4", undefined);
    expect(map.switches[0].door).toBeNull();
  });
});

function lineOn(map: GameMap, wall: string) {
  return linesOf(map).find((item) => item.line.wall === wall)!;
}

function lowerFloor(patch: Partial<LineAction>): LineAction {
  return {
    kind: "floor-lower",
    trigger: "walk",
    repeat: false,
    tag: 0,
    ...patch,
  };
}

function lineIssues(wall: string, patch: Partial<LineAction>) {
  return validateMap(
    updateLine(testMap, wall, { action: lowerFloor(patch) }),
  ).map((issue) => issue.id);
}

function doorOpenerIssues(wall: string, trigger: LineAction["trigger"]) {
  return validateMap(
    setLineTarget(
      updateLine({ ...testMap, switches: [] }, wall, {
        action: { ...lowerFloor({ trigger }), kind: "door-open" },
      }),
      wall,
      "sector-4",
    ),
  ).map((issue) => issue.id);
}

describe("line editing", () => {
  const solidWall = wallKey("v1", "v15");
  const openWall = wallKey("v3", "v4");

  it("writes flags without losing the line's own bits", () => {
    const solid = lineOn(
      updateLine(testMap, solidWall, { blocksEnemies: true, hidden: true }),
      solidWall,
    );
    expect(solid.flags).toBe(1 | 2 | 128);
    const open = lineOn(
      updateLine(testMap, openWall, {
        blocksAll: true,
        upperFixed: true,
        lowerFixed: true,
      }),
      openWall,
    );
    expect(open.flags).toBe(1 | 4 | 8 | 16);
  });

  it("writes each side's offsets and textures", () => {
    const map = updateLineSide(testMap, openWall, "sector-2", {
      offsetX: -8,
      offsetY: 16,
      lower: "BRICK1",
    });
    const { lines } = buildLevel(map);
    const index = lines.findIndex((line) => line.wall === openWall);
    const linedefs = new DataView(lump(map, "LINEDEFS").buffer);
    const backIndex = linedefs.getInt16(index * 14 + 12, true);
    const sidedefs = lump(map, "SIDEDEFS");
    const view = new DataView(sidedefs.buffer);
    expect(view.getInt16(backIndex * 30, true)).toBe(-8);
    expect(view.getInt16(backIndex * 30 + 2, true)).toBe(16);
    const lower = sidedefs.slice(backIndex * 30 + 12, backIndex * 30 + 20);
    expect(String.fromCharCode(...lower).replace(/\0+$/, "")).toBe("BRICK1");
  });

  it("gives a line's target its tag and keeps switch doors apart", () => {
    const doorIndex = testMap.sectors.findIndex((item) => item.door);
    const taken = doorIndex + 1;
    const withAction = updateSector(
      updateLine(testMap, openWall, {
        action: lowerFloor({ tag: taken }),
      }),
      "sector-1",
      { tag: taken, effect: "flicker" },
    );
    expect(validateMap(withAction)).toEqual([]);
    expect(lineOn(withAction, openWall)).toMatchObject({
      special: 38,
      tag: taken,
    });
    const sectors = new DataView(lump(withAction, "SECTORS").buffer);
    expect(sectors.getInt16(22, true)).toBe(17);
    expect(sectors.getInt16(24, true)).toBe(taken);
    expect(sectors.getInt16(doorIndex * 26 + 24, true)).not.toBe(taken);
  });

  it("assigns one tag when a target is chosen", () => {
    const map = setLineTarget(
      updateLine(testMap, openWall, { action: lowerFloor({}) }),
      openWall,
      "sector-3",
    );
    const tag = map.lines![openWall].action!.tag;
    expect(tag).toBeGreaterThan(0);
    expect(map.sectors[2].tag).toBe(tag);
  });

  it("refuses actions the engine can't run on a line", () => {
    expect(
      lineIssues(solidWall, {
        kind: "door-raise",
        trigger: "door",
        repeat: true,
      }),
    ).toContain(`line-door:${solidWall}`);
    expect(lineIssues(solidWall, { tag: 5 })).toContain(
      `line-walk:${solidWall}`,
    );
    expect(lineIssues(openWall, {})).toContain(`line-target:${openWall}`);
    expect(lineIssues(openWall, { tag: 99 })).toContain(`line-tag:${openWall}`);
  });

  it("requires the key a locked line needs", () => {
    const locked = updateLine(testMap, openWall, {
      action: {
        kind: "door-raise",
        trigger: "door",
        repeat: true,
        key: "red",
        tag: 0,
      },
    });
    expect(lineOn(locked, openWall).special).toBe(28);
    expect(validateMap(locked).map((issue) => issue.id)).toContain(
      `line-key:${openWall}`,
    );
    const withKey = addThing(locked, "red-key", { x: 64, y: 64 }).map;
    expect(validateMap(withKey)).toEqual([]);
  });

  it("runs an action from an unwired switch", () => {
    const item = { ...testMap.switches[0], door: null };
    const wall = wallKey(item.from, item.to);
    const map = updateSector(
      updateLine({ ...testMap, switches: [item] }, wall, {
        action: lowerFloor({ trigger: "switch", tag: 4 }),
      }),
      "sector-2",
      { tag: 4 },
    );
    const issues = validateMap(map).map((issue) => issue.id);
    expect(issues).not.toContain("switch-unwired:switch-1");
    expect(lineOn(map, wall)).toMatchObject({ special: 23, tag: 4 });
  });

  it("moves a wall's action onto a switch placed on it", () => {
    const wall = wallKey("v10", "v11");
    const action = lowerFloor({ trigger: "switch", tag: 4 });
    const map = updateLine(testMap, wall, { action, hidden: true });
    const at = { x: 960, y: 160 };
    const added = addSwitch(map, freeWallNear(map, at, 32)!, at);
    const item = added.map.switches.at(-1)!;
    expect(added.map.lines?.[wallKey(item.from, item.to)]).toEqual({ action });
    const halves = Object.values(added.map.lines!).filter(
      (line) => line.hidden,
    );
    expect(halves).toHaveLength(2);
    expect(halves.every((line) => !line.action)).toBe(true);
  });

  it("accepts a switch door opened by a line action", () => {
    const map = setLineTarget(
      updateLine({ ...testMap, switches: [] }, openWall, {
        action: { ...lowerFloor({}), kind: "door-open" },
      }),
      openWall,
      "sector-4",
    );
    expect(validateMap(map)).toEqual([]);
  });

  it("accepts a switch door opened by pressing its face", () => {
    const action: LineAction = {
      kind: "door-open",
      trigger: "door",
      repeat: false,
      tag: 0,
    };
    const map = updateLine(
      { ...testMap, switches: [] },
      wallKey("v13", "v14"),
      { action },
    );
    expect(validateMap(map)).toEqual([]);
  });

  it("doesn't count lines that can't reach a closed door", () => {
    expect(doorOpenerIssues(wallKey("v13", "v14"), "walk")).toContain(
      "door-unwired:sector-4",
    );
    expect(doorOpenerIssues(wallKey("v13", "v7"), "switch")).toContain(
      "door-unwired:sector-4",
    );
  });

  it("leaves a wall's action alone when adding a door switch", () => {
    const wall = wallKey("v5", "v6");
    const action: LineAction = {
      kind: "exit",
      trigger: "switch",
      repeat: false,
      tag: 0,
    };
    const map = updateLine(testMap, wall, { action });
    const added = addSwitchInRoom(map, "sector-1", "sector-4")!;
    expect(added.map.lines?.[wall]?.action).toEqual(action);
    expect(lineOn(added.map, wall).special).toBe(11);
  });

  it("picks a free tag when the highest one is taken", () => {
    const map = setLineTarget(
      updateLine(updateSector(testMap, "sector-1", { tag: 32767 }), openWall, {
        action: lowerFloor({}),
      }),
      openWall,
      "sector-2",
    );
    expect(map.lines![openWall].action!.tag).toBe(1);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("only offers triggers the line can use", () => {
    expect(triggersFor("door-raise", false)).toEqual(["switch"]);
    expect(triggersFor("door-raise", true)).toContain("door");
    expect(
      fitLineAction(
        { kind: "exit", trigger: "door", repeat: true, tag: 0 },
        true,
      ),
    ).toMatchObject({ trigger: "switch", repeat: false });
  });

  it("forgets a deleted room's side and any line left without a wall", () => {
    const map = updateLineSide(
      updateLineSide(testMap, openWall, "sector-2", { offsetX: 8 }),
      solidWall,
      "sector-1",
      { offsetX: 8 },
    );
    const removed = removeSector(map, "sector-1");
    expect(removed.lines?.[solidWall]).toBeUndefined();
    expect(removed.lines?.[openWall]?.sides).toEqual({
      "sector-2": { offsetX: 8 },
    });
  });

  it("keeps a wall's settings on both halves when a switch splits it", () => {
    const wall = wallKey("v10", "v11");
    const map = updateLine(testMap, wall, { hidden: true });
    const at = { x: 960, y: 160 };
    const added = addSwitch(map, freeWallNear(map, at, 32)!, at);
    expect(added.map.lines?.[wall]).toBeUndefined();
    expect(
      Object.values(added.map.lines ?? {}).filter((line) => line.hidden),
    ).toHaveLength(2);
  });
});

describe("context menu edits", () => {
  const ids = ["imp-1", "demon-1"];
  const map: GameMap = {
    ...testMap,
    things: [
      { id: "player-1", kind: "player", x: 96, y: 160, angle: 0 },
      { id: "imp-1", kind: "imp", x: 128, y: 64, angle: 90 },
      { id: "demon-1", kind: "demon", x: 192, y: 64, angle: 0 },
    ],
  };

  it("changes and turns every selected thing", () => {
    const changed = faceThings(changeThings(map, ids, "zombieman"), ids, 180);
    expect(changed.things.slice(1)).toMatchObject([
      { kind: "zombieman", angle: 180 },
      { kind: "zombieman", angle: 180 },
    ]);
    expect(changed.things[0].kind).toBe("player");
  });

  it("duplicates things beside themselves but never the player", () => {
    const copies = duplicateThings(map, ["player-1", "imp-1"]);
    expect(copies.ids).toEqual(["imp-2"]);
    expect(copies.map.things.at(-1)).toMatchObject({
      kind: "imp",
      x: 144,
      y: 80,
      angle: 90,
    });
  });

  it("keeps a duplicate inside the thing's room", () => {
    const cornered: GameMap = {
      ...map,
      things: [
        ...map.things,
        { id: "imp-9", kind: "imp", x: 376, y: 304, angle: 0 },
      ],
    };
    const copies = duplicateThings(cornered, ["imp-9"]);
    const copy = copies.map.things.at(-1)!;
    expect(sectorAt(copies.map, copy)?.id).toBe("sector-1");
    expect(validateMap(copies.map).map((issue) => issue.id)).not.toContain(
      `outside:${copy.id}`,
    );
  });

  it("deletes every selected thing", () => {
    expect(removeThings(map, ids).things.map((item) => item.id)).toEqual([
      "player-1",
    ]);
  });

  it("snaps only the chosen corners", () => {
    const off = {
      ...testMap,
      vertices: {
        ...testMap.vertices,
        v1: { x: 3, y: 5 },
        v2: { x: 387, y: 5 },
      },
    };
    const snapped = snapCorners(off, ["v1"]);
    expect(snapped.vertices.v1).toEqual({ x: 0, y: 8 });
    expect(snapped.vertices.v2).toEqual({ x: 387, y: 5 });
  });

  it("selects every corner of the rooms sharing a corner", () => {
    const corners = connectedCorners(testMap, ["v3"]);
    expect(corners).toEqual(expect.arrayContaining(["v1", "v6", "v13", "v14"]));
    expect(corners).not.toContain("v9");
  });

  it("only offers a switch on a free solid wall", () => {
    expect(freeWallAt(testMap, wallKey("v1", "v15"))).not.toBeNull();
    expect(freeWallAt(testMap, wallKey("v3", "v4"))).toBeNull();
  });
});

describe("context menu targets", () => {
  it("uses the pressed item's type in a mixed selection", () => {
    const keys = ["v1", "thing:imp-1", "v2"];
    expect(targetForKeys(keys, null, "v2")).toMatchObject({
      kind: "corners",
      ids: ["v1", "v2"],
      keepSelection: true,
    });
    expect(targetForKeys(keys, null, "thing:imp-1")).toMatchObject({
      kind: "things",
      ids: ["imp-1"],
      keepSelection: true,
    });
  });

  it("notices when undo removes a target", () => {
    const wall = wallTarget("sector-1", wallKey("v1", "v15"), null);
    expect(targetExists(testMap, wall)).toBe(true);
    expect(targetExists(removeSector(testMap, "sector-1"), wall)).toBe(false);
    expect(
      targetExists(testMap, { kind: "things", ids: ["gone"], point: null }),
    ).toBe(false);
  });

  it("maps 3D surfaces to the same targets as the map", () => {
    expect(targetForSurface(testMap, "floor:sector-1", null)).toMatchObject({
      kind: "room",
      sector: "sector-1",
    });
    const wall = wallKey("v1", "v15");
    expect(
      targetForSurface(testMap, `wall:sector-1:${wall}:middle`, null),
    ).toMatchObject({ kind: "wall", sector: "sector-1", wall });
    const switched = wallKey("v15", "v16");
    expect(
      targetForSurface(testMap, `wall:sector-1:${switched}:middle`, null),
    ).toMatchObject({ kind: "switch", id: "switch-1" });
    expect(targetForSurface(testMap, "thing:player-1", null)).toMatchObject({
      kind: "things",
      ids: ["player-1"],
    });
  });

  it("frames a wall from inside a room and refuses door rooms", () => {
    const view = viewOfTarget(
      testMap,
      wallTarget("sector-1", wallKey("v1", "v15"), null),
    );
    expect(view?.at).toEqual({ x: 80, y: 0 });
    expect(view && canStand(testMap, view.from)).toBe(true);
    expect(
      viewOfTarget(testMap, {
        kind: "room",
        sector: "sector-4",
        point: null,
      }),
    ).toBeNull();
  });
});

function thingFlagsOf(map: GameMap, index: number) {
  return new DataView(lump(map, "THINGS").buffer).getInt16(
    index * 10 + 8,
    true,
  );
}

describe("thing settings", () => {
  it("adds missing co-op starts beside player 1", () => {
    const map = addPlayerStarts(testMap, 4);
    const first = map.things.find((thing) => thing.kind === "player")!;
    const added = map.things.filter((thing) =>
      ["player-2", "player-3", "player-4"].includes(thing.kind),
    );
    expect(added).toHaveLength(3);
    for (const start of added) {
      expect(sectorAt(map, start)).toBe(sectorAt(map, first));
      expect(start.angle).toBe(first.angle);
    }
    expect(validateMap(map)).toEqual([]);
    expect(addPlayerStarts(map, 4)).toBe(map);
  });

  it("writes difficulty and ambush flags", () => {
    const map = updateThing(
      updateThing(testMap, "imp-1", {
        skills: ["easy", "hard"],
        ambush: true,
      }),
      "player-1",
      { ambush: true },
    );
    const imp = map.things.findIndex((thing) => thing.id === "imp-1");
    const player = map.things.findIndex((thing) => thing.id === "player-1");
    expect(thingFlagsOf(map, imp)).toBe(1 | 4 | 8);
    expect(thingFlagsOf(map, player)).toBe(7);
  });

  it("requires a locked door's key on every difficulty", () => {
    const locked = addThing(
      updateLine(testMap, wallKey("v3", "v4"), {
        action: {
          kind: "door-raise",
          trigger: "door",
          repeat: true,
          key: "blue",
          tag: 0,
        },
      }),
      "blue-key",
      { x: 64, y: 64 },
    );
    expect(validateMap(locked.map)).toEqual([]);
    const hardOnly = updateThing(locked.map, locked.id, { skills: ["hard"] });
    expect(validateMap(hardOnly).map((issue) => issue.id)).toContain(
      `line-key:${wallKey("v3", "v4")}`,
    );
  });

  it("changes each selected thing from its own values", () => {
    const map = updateThing(testMap, "imp-1", { skills: ["hard"] });
    const next = updateThings(map, ["imp-1", "zombieman-1"], (thing) => ({
      angle: thing.id === "imp-1" ? 90 : 270,
    }));
    expect(next.things.find((item) => item.id === "imp-1")).toMatchObject({
      angle: 90,
      skills: ["hard"],
    });
    expect(next.things.find((item) => item.id === "zombieman-1")?.angle).toBe(
      270,
    );
  });

  it("rejects a player start inside a closed door", () => {
    const start = testMap.things.find((thing) => thing.kind === "player")!;
    const map = updateThing(testMap, start.id, { x: 504, y: 160 });
    expect(validateMap(map).map((issue) => issue.id)).toContain(
      `in-door:${start.id}`,
    );
  });

  it("warns about a monster waiting inside a closed door", () => {
    const map = updateThing(testMap, "imp-1", { x: 504, y: 160 });
    expect(validateMap(map)).toEqual([]);
    expect(checkMap(map)).toContainEqual(
      expect.objectContaining({ id: "in-door:imp-1", severity: "warning" }),
    );
  });

  it("gives every thing a unique engine type", () => {
    const types = thingKinds.map((kind) => thingCatalog[kind].doomType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("copies difficulty settings with a thing", () => {
    const map = updateThing(testMap, "imp-1", {
      skills: ["hard"],
      ambush: true,
    });
    const copies = duplicateThings(map, ["imp-1"]);
    expect(copies.map.things.at(-1)).toMatchObject({
      skills: ["hard"],
      ambush: true,
    });
  });

  it("balances only what appears on the difficulty", () => {
    const things: GameMap["things"] = [
      { id: "player-1", kind: "player", x: 96, y: 160, angle: 0 },
      { id: "a", kind: "pain-elemental", x: 64, y: 64, angle: 0 },
      { id: "b", kind: "imp", x: 96, y: 64, angle: 0, skills: ["hard"] },
      { id: "c", kind: "medikit", x: 128, y: 64, angle: 0 },
      { id: "d", kind: "clip", x: 160, y: 64, angle: 0 },
      { id: "e", kind: "blue-key", x: 192, y: 64, angle: 0 },
    ];
    const map = updateLine({ ...testMap, things }, wallKey("v3", "v4"), {
      action: {
        kind: "door-raise",
        trigger: "door",
        repeat: true,
        key: "red",
        tag: 0,
      },
    });
    expect(mapBalance(map, "medium")).toEqual({
      enemies: 1,
      health: 1,
      ammo: 1,
      keys: 1,
      keysNeeded: 1,
      healthShort: 0,
      ammoShort: 0,
    });
    expect(mapBalance(map, "hard").enemies).toBe(2);
    const crowded = {
      ...map,
      things: Array.from({ length: 6 }, (_, index) => ({
        ...things[1],
        id: `p${index}`,
      })),
    };
    expect(mapBalance(crowded, "medium")).toMatchObject({
      healthShort: 8,
      ammoShort: 31,
    });
  });
});

function checkIds(map: GameMap) {
  return checkMap(map).map((issue) => issue.id);
}

describe("map check", () => {
  it("separates warnings from blocking errors", () => {
    const checks = checkMap(testMap);
    expect(checks.every((issue) => issue.severity === "warning")).toBe(true);
    expect(checks.map((issue) => issue.id)).toContain("no-exit");
    expect(validateMap(testMap)).toEqual([]);
  });

  it("lets a map hold many deathmatch starts but asks for four", () => {
    let map = testMap;
    for (const [index, x] of [64, 128, 192].entries()) {
      map = addThing(map, "deathmatch-start", { x, y: 64 + index }).map;
    }
    expect(
      map.things.filter((thing) => thing.kind === "deathmatch-start"),
    ).toHaveLength(3);
    expect(validateMap(map)).toEqual([]);
    expect(checkIds(map)).toContain("deathmatch-starts");
    map = addThing(map, "deathmatch-start", { x: 256, y: 64 }).map;
    expect(checkIds(map)).not.toContain("deathmatch-starts");
  });

  it("warns about a co-op start no player can reach", () => {
    const map = addThing(testMap, "player-3", { x: 96, y: 256 }).map;
    expect(
      checkMap(map).find((issue) => issue.id === "coop-starts")?.detail,
    ).toBe("Player 2 has none");
    expect(
      checkIds(addThing(map, "player-2", { x: 160, y: 256 }).map),
    ).not.toContain("coop-starts");
  });

  it("warns about unused keys and thin supplies", () => {
    const key = addThing(testMap, "yellow-key", { x: 64, y: 64 });
    const crowded = Array.from({ length: 5 }, (_, index) => ({
      id: `pain-${index}`,
      kind: "pain-elemental" as const,
      x: 640,
      y: 64,
      angle: 0,
    }));
    expect(
      checkIds({ ...key.map, things: [...key.map.things, ...crowded] }),
    ).toEqual(
      expect.arrayContaining([
        `key-unused:${key.id}`,
        "low-health",
        "low-ammo",
      ]),
    );
  });

  it("groups every issue for the build dialog", () => {
    const broken = updateSector({ ...testMap, things: [] }, "sector-1", {
      ceiling: 0,
    });
    const checks = buildChecks(broken);
    const names = (name: string) =>
      checks
        .find((check) => check.name === name)
        ?.issues.map((item) => item.id);
    expect(names("Closed sectors")).toContain("height:sector-1");
    expect(names("Player start")).toContain("no-player");
    expect(names("Exit")).toContain("no-exit");
    expect(checks.flatMap((check) => check.issues)).toHaveLength(
      checkMap(broken).length,
    );
  });

  it("keeps range errors in one group and marks unknown groups", () => {
    const tall = updateSector(testMap, "sector-1", { ceiling: 40000 });
    const checks = buildChecks(tall);
    const holding = checks.filter((check) =>
      check.issues.some((issue) => issue.id === "height-range:sector-1"),
    );
    expect(holding.map((check) => check.name)).toEqual(["Format limits"]);
    expect(checks.find((check) => check.name === "Wall sides")?.waiting).toBe(
      true,
    );
    expect(buildChecks(testMap).some((check) => check.waiting)).toBe(false);
  });

  it("makes safe WAD file names", () => {
    expect(wadFileName("Cinder Works!")).toBe("Cinder-Works.wad");
    expect(wadFileName("level.WAD")).toBe("level.wad");
    expect(wadFileName("***")).toBe("wadsmith-map01.wad");
    expect(wadFileName("..")).toBe("wadsmith-map01.wad");
    expect(wadFileName("level.wad.")).toBe("level.wad");
    expect(wadFileName("x".repeat(300))).toHaveLength(68);
  });

  it("splits room errors into a title and place", () => {
    expect(
      issueText({
        id: "x",
        message: "Arena: ceiling must be above the floor.",
      }),
    ).toEqual({ title: "Ceiling must be above the floor", detail: "Arena" });
  });

  it("fixes problems with one safe answer", () => {
    const low = updateSector(testMap, "sector-1", { ceiling: 0 });
    const issue = validateMap(low).find((item) =>
      item.id.startsWith("height"),
    )!;
    expect(validateMap(fixIssue(low, issue)!)).toEqual([]);
    const unwired = { ...testMap, switches: [] };
    const door = validateMap(unwired).find((item) =>
      item.id.startsWith("door-unwired"),
    )!;
    expect(fixIssue(unwired, door)).toBeNull();
    const wall = wallKey("v1", "v15");
    const walking = updateLine(testMap, wall, {
      action: { kind: "exit", trigger: "walk", repeat: false, tag: 0 },
    });
    const walkIssue = validateMap(walking).find((item) =>
      item.id.startsWith("line-walk"),
    )!;
    const fixedWalk = fixIssue(walking, walkIssue)!;
    expect(fixedWalk.lines?.[wall]?.action).toMatchObject({
      kind: "exit",
      trigger: "switch",
    });
    expect(validateMap(fixedWalk)).toEqual([]);
    expect(fixIssue(testMap, { id: "outside:imp-1", message: "x" })).toBeNull();
  });

  it("finds what an issue points at", () => {
    expect(targetForIssue(testMap, "sector-2")).toMatchObject({
      kind: "room",
    });
    expect(targetForIssue(testMap, "imp-1")).toMatchObject({
      kind: "things",
    });
    expect(targetForIssue(testMap, "switch-1")).toMatchObject({
      kind: "switch",
    });
    expect(targetForIssue(testMap, wallKey("v3", "v4"))).toMatchObject({
      kind: "wall",
    });
  });

  it("counts the wall parts a map actually shows", () => {
    const shared = wallKey("v3", "v4");
    const painted = updateLineSide(testMap, shared, "sector-1", {
      upper: "BRICK1",
    });
    expect(wallUse(painted).get("BRICK1")).toBe(1);
  });

  it("keeps a teleporter on a solid wall loadable and offers to remove it", () => {
    const map = updateLine(testMap, "v1|v15", {
      action: newLineAction(false, "teleport"),
    });
    expect(() => parseMapFile(serializeMap(map))).not.toThrow();
    const issue = validateMap(map).find((item) =>
      item.id.startsWith("line-walk"),
    )!;
    expect(issue).toBeDefined();
    expect(fixIssue(map, issue)?.lines?.["v1|v15"]?.action).toBeUndefined();
  });

  it("builds a line from the room chosen as its front", () => {
    const front = (map: GameMap) => {
      const { lines, sectors } = buildLevel(map);
      return sectors[lines.find((line) => line.wall === "v3|v4")!.frontSector]
        .id;
    };
    expect(front(updateLine(testMap, "v3|v4", { front: "sector-2" }))).toBe(
      "sector-2",
    );
    expect(front(updateLine(testMap, "v3|v4", { front: "sector-1" }))).toBe(
      "sector-1",
    );
    const removed = removeSector(
      updateLine(testMap, "v3|v4", { front: "sector-2" }),
      "sector-2",
    );
    expect(removed.lines?.["v3|v4"]?.front).toBeUndefined();
    expect(() => parseMapFile(serializeMap(removed))).not.toThrow();
  });

  it("scrolls a wall's texture unless its line has an action", () => {
    const special = (map: GameMap) => {
      const index = buildLevel(map).lines.findIndex(
        (line) => line.wall === "v3|v4",
      );
      const lines = compileLumps(map).find((lump) => lump.name === "LINEDEFS")!;
      return new DataView(lines.data.buffer, lines.data.byteOffset).getUint16(
        index * 14 + 6,
        true,
      );
    };
    const scrolling = updateLine(testMap, "v3|v4", { scrolls: true });
    expect(special(scrolling)).toBe(48);
    expect(
      special(
        updateLine(scrolling, "v3|v4", {
          action: newLineAction(true, "floor-lower"),
        }),
      ),
    ).not.toBe(48);
    expect(parseMapFile(serializeMap(scrolling))).toEqual(scrolling);
  });

  it("warns about a spawn spot level with a monster spawner", () => {
    const spawner = addThing(testMap, "boss-shooter", { x: 64, y: 96 }).map;
    const warned = (x: number, y: number) =>
      checkMap(addThing(spawner, "spawn-spot", { x, y }).map).some((issue) =>
        issue.id.startsWith("spawn-level"),
      );
    expect(warned(1088, 96)).toBe(true);
    expect(warned(1088, 100)).toBe(true);
    expect(warned(1088, -128)).toBe(false);
  });

  it("lists every line action once, under its group", () => {
    const groups = lineActionGroups(lineActionKinds);
    expect(
      groups.flatMap((group) => group.items.map((item) => item.value)),
    ).toHaveLength(lineActionKinds.length);
    expect(groups.map((group) => group.label)).toEqual([
      "Doors",
      "Floors",
      "Ceilings",
      "Lifts",
      "Crushers",
      "Stairs",
      "Teleporters",
      "Level",
    ]);
    const floors = groups.find((group) => group.label === "Floors")!;
    expect(floors.items[0]).toMatchObject({
      label: "Floor: lower to lowest",
      short: "Lower to lowest",
    });
  });

  it("gives every line action its own Doom specials", () => {
    const specials = Object.values(lineActions).flatMap(({ triggers, keys }) =>
      [
        ...Object.values(triggers),
        ...Object.values(keys ?? {}).flatMap((colors) => Object.values(colors)),
      ].flatMap(({ once, repeat }) => [once, repeat]),
    );
    const defined = specials.filter((special) => special !== undefined);
    expect(new Set(defined).size).toBe(defined.length);
  });

  it("gives every thing its own Doom number", () => {
    const numbers = thingKinds.map((kind) => thingCatalog[kind].doomType);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("knows every catalog texture is in Freedoom", () => {
    const flats: readonly string[] = freedoomFlats;
    const walls: readonly string[] = freedoomWalls;
    expect(
      [...floorTextures, ...ceilingTextures].every((name) =>
        flats.includes(name),
      ),
    ).toBe(true);
    expect(wallTextures.every((name) => walls.includes(name))).toBe(true);
    expect([...flats, ...walls].every((name) => name.length <= 8)).toBe(true);
  });
});
