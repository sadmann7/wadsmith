import { describe, expect, it } from "vitest";

import type { GameMap, LineAction } from "@/lib/map/types";

import { wadFileName } from "@/components/editor/build-dialog";
import { defined } from "@/lib/defined";
import {
  getCanStand,
  targetExists,
  targetForIssue,
  targetForKeys,
  targetForSurface,
  viewOfTarget,
  wallTarget,
} from "@/lib/editor/map-target";
import { games } from "@/lib/engine/game";
import { mapBalance } from "@/lib/map/balance";
import {
  generalizedClass,
  generalizedFields,
  generalizedTrigger,
  newGeneralized,
  withField,
} from "@/lib/map/boom";
import {
  ceilingTextures,
  floorTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
} from "@/lib/map/catalog";
import { buildChecks, checkMap, fixIssue, issueText } from "@/lib/map/checks";
import {
  addDetail,
  addPlayerStarts,
  addRoom,
  addRoomOnSide,
  addSwitch,
  addSwitchInRoom,
  addThing,
  changeThings,
  connectedCorners,
  duplicateThings,
  faceThings,
  fillHole,
  flipDetailLine,
  freeWallAt,
  freeWallNear,
  makePillar,
  mergeCorners,
  removeDetailLine,
  removeHole,
  removeSector,
  removeThings,
  setDoorTexture,
  setLineTarget,
  setRoomDoor,
  snapCorners,
  snapPoint,
  splitWall,
  updateLine,
  updateLineSide,
  updateSector,
  updateThing,
  updateThings,
  wallNear,
} from "@/lib/map/edit";
import { featuredMaps } from "@/lib/map/featured";
import { partKeys, selectedParts, transformParts } from "@/lib/map/fragment";
import { freedoomFlats, freedoomWalls } from "@/lib/map/freedoom-textures";
import {
  containerOf,
  interiorPoint,
  pointInPolygon,
  sectorAt,
  wallKey,
  wallOwners,
} from "@/lib/map/geometry";
import {
  describeLine,
  fitLineAction,
  lineActionGroups,
  lineActionKinds,
  lineActions,
  newLineAction,
  triggerChoices,
  triggersFor,
} from "@/lib/map/lines";
import { blankMap, starterMap } from "@/lib/map/starter-map";
import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { describeSurface, paintSurface, surfaceKey } from "@/lib/map/surfaces";
import { islandMap, testMap } from "@/lib/map/test-map";
import { wallUse } from "@/lib/map/textures";
import { inspectMap, validateMap } from "@/lib/map/validate";

import {
  buildLevel,
  compileEpisode,
  compileLumps,
  compileMap,
  toDoom,
} from "./compile";
import { inspectWads, readLumps } from "./inspect";
import { buildNodes, subsectorFlag } from "./nodes";
import { readMaps } from "./read-map";

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

const solidLine = { twoSided: false, doorBehind: false };
const openLine = { twoSided: true, doorBehind: false };
const doorLine = { twoSided: true, doorBehind: true };

describe("compileMap", () => {
  it("writes a patch WAD with every map lump in engine order", () => {
    const wad = compileMap(testMap);
    const view = new DataView(wad.buffer);
    expect(String.fromCharCode(...wad.slice(0, 4))).toBe("PWAD");
    expect(view.getInt32(4, true)).toBe(13);
    const names = Array.from({ length: 13 }, (_, index) => {
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
      "UMAPINFO",
      "COMPLVL",
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
    expect(defined(bsp.nodes.at(-1)).rightChild).toBeDefined();
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

describe("rooms inside rooms", () => {
  const pillar = defined(makePillar(islandMap, "stage"));

  it("accepts a room inside another and finds it under the pointer", () => {
    expect(validateMap(islandMap)).toEqual([]);
    expect(sectorAt(islandMap, { x: 256, y: 256 })?.id).toBe("stage");
    expect(sectorAt(islandMap, { x: 64, y: 64 })?.id).toBe("yard");
    expect(containerOf(islandMap, islandMap.sectors[1])?.id).toBe("yard");
    expect(containerOf(islandMap, islandMap.sectors[0])).toBeNull();
  });

  it("opens the inner room onto the outer one through every wall", () => {
    const { vertices, lines } = buildLevel(islandMap);
    expect(lines).toHaveLength(8);
    const shared = lines.filter((line) => line.backSector !== null);
    expect(shared).toHaveLength(4);
    const inside = toDoom({ x: 256, y: 256 });
    for (const line of shared) {
      expect(line).toMatchObject({ frontSector: 1, backSector: 0 });
      expect(sideOf(vertices, line, inside)).toBeLessThan(0);
    }
    expect(linesOf(islandMap).filter((item) => item.flags & 4)).toHaveLength(4);
    expectConvexLeaves(islandMap);
  });

  it("turns an inner room into a pillar with walls facing the room", () => {
    expect(pillar.sectors).toHaveLength(1);
    expect(pillar.sectors[0].holes).toEqual([["e", "f", "g", "h"]]);
    expect(validateMap(pillar)).toEqual([]);
    expect(sectorAt(pillar, { x: 256, y: 256 })).toBeUndefined();
    expect(sectorAt(pillar, { x: 64, y: 64 })?.id).toBe("yard");
    const { vertices, lines } = buildLevel(pillar);
    expect(lines).toHaveLength(8);
    expect(lines.every((line) => line.backSector === null)).toBe(true);
    const middle = toDoom({ x: 256, y: 256 });
    for (const line of lines) {
      const onPillar = [line.start, line.end].every(
        (index) =>
          vertices[index].x > 100 &&
          vertices[index].x < 400 &&
          Math.abs(vertices[index].y) > 100 &&
          Math.abs(vertices[index].y) < 400,
      );
      const side = sideOf(vertices, line, middle);
      if (onPillar) expect(side).toBeGreaterThan(0);
      else expect(side).toBeLessThan(0);
    }
    expectConvexLeaves(pillar);
    expect(parseMapFile(serializeMap(pillar))).toEqual(pillar);
  });

  it("turns a pillar back into a room or takes it away", () => {
    const filled = defined(fillHole(pillar, "yard", 0));
    expect(filled.map.sectors).toHaveLength(2);
    expect(filled.map.sectors[0].holes).toBeUndefined();
    expect(filled.map.sectors[1]).toMatchObject({
      id: filled.id,
      vertices: ["e", "f", "g", "h"],
      floor: 0,
      ceiling: 128,
    });
    expect(validateMap(filled.map)).toEqual([]);
    const gone = removeHole(pillar, "yard", 0);
    expect(gone.sectors[0].holes).toBeUndefined();
    expect(Object.keys(gone.vertices).toSorted()).toEqual(["a", "b", "c", "d"]);
    expect(makePillar(islandMap, "yard")).toBeNull();
  });

  it("finds the wall of an inner room from either side", () => {
    expect(wallNear(islandMap, { x: 256, y: 186 }, 14)).toEqual({
      sector: "yard",
      wall: wallKey("e", "f"),
    });
    expect(wallNear(islandMap, { x: 256, y: 198 }, 14)).toEqual({
      sector: "stage",
      wall: wallKey("e", "f"),
    });
  });

  it("lets a room lean on a pillar and cover that side of it", () => {
    const ledge = addRoom(pillar, [
      { x: 192, y: 192 },
      { x: 192, y: 64 },
      { x: 320, y: 64 },
      { x: 320, y: 192 },
    ]);
    expect(validateMap(ledge.map)).toEqual([]);
    expect(
      wallOwners(ledge.map)
        .get(wallKey("e", "f"))
        ?.map((sector) => sector.id),
    ).toEqual([ledge.id]);
    const { lines } = buildLevel(ledge.map);
    expect(lines).toHaveLength(11);
    expect(lines.find((line) => line.wall === wallKey("e", "f"))).toMatchObject(
      { frontSector: 1, backSector: null },
    );
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(3);
    expectConvexLeaves(ledge.map);
    const pressed = addSwitch(
      ledge.map,
      defined(freeWallAt(ledge.map, wallKey("e", "f"))),
      { x: 256, y: 192 },
    );
    expect(pressed.map.sectors[0].holes?.[0]).toHaveLength(6);
    expect(pressed.map.sectors[1].vertices).toHaveLength(6);
    expect(validateMap({ ...pressed.map, switches: [] })).toEqual([]);
  });

  it("makes a pillar out of one of two rooms side by side", () => {
    const pair = addRoom(islandMap, [
      { x: 320, y: 192 },
      { x: 448, y: 192 },
      { x: 448, y: 320 },
      { x: 320, y: 320 },
    ]);
    expect(validateMap(pair.map)).toEqual([]);
    const made = defined(makePillar(pair.map, "stage"));
    expect(validateMap(made)).toEqual([]);
    expect(() => compileMap(made)).not.toThrow();
    expect(
      wallOwners(made)
        .get(wallKey("f", "g"))
        ?.map((sector) => sector.id),
    ).toEqual([pair.id]);
  });

  it("finds a point inside a notched room and keeps it in its yard", () => {
    const notch = [
      { x: 0, y: 0 },
      { x: 26, y: 97 },
      { x: 25, y: 0 },
      { x: 10, y: 35 },
      { x: 10, y: -35 },
      { x: 26, y: -97 },
    ];
    expect(pointInPolygon(interiorPoint(notch), notch)).toBe(true);
    const notched: GameMap = {
      ...islandMap,
      vertices: {
        ...islandMap.vertices,
        ...Object.fromEntries(
          notch.map((point, index) => [
            `n${index}`,
            { x: point.x + 100, y: point.y + 100 },
          ]),
        ),
        p1: { x: 112, y: 97 },
        p2: { x: 118, y: 97 },
        p3: { x: 118, y: 103 },
        p4: { x: 112, y: 103 },
      },
      sectors: [
        { ...islandMap.sectors[0], holes: [["p1", "p2", "p3", "p4"]] },
        {
          ...islandMap.sectors[1],
          vertices: ["n0", "n1", "n2", "n3", "n4", "n5"],
        },
      ],
    };
    expect(validateMap(notched)).toEqual([]);
    expect(containerOf(notched, notched.sectors[1])?.id).toBe("yard");
    const { lines } = buildLevel(notched);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(6);
  });

  it("puts a switch on a pillar's wall", () => {
    expect(wallNear(pillar, { x: 256, y: 190 }, 14)).toEqual({
      sector: "yard",
      wall: wallKey("e", "f"),
    });
    const free = freeWallAt(pillar, wallKey("e", "f"));
    expect(free).toMatchObject({ sector: "yard" });
    expect(freeWallAt(islandMap, wallKey("e", "f"))).toBeNull();
    const added = addSwitch(pillar, defined(free), { x: 256, y: 192 });
    expect(added.map.switches).toHaveLength(1);
    expect(added.map.sectors[0].holes?.[0]).toHaveLength(6);
    expect(added.map.sectors[0].vertices).toHaveLength(4);
  });

  it("keeps things out of pillars", () => {
    const issues = validateMap({
      ...pillar,
      things: [
        ...pillar.things,
        { id: "imp-1", kind: "imp", x: 256, y: 256, angle: 0 },
      ],
    });
    expect(issues.map((issue) => issue.id)).toContain("outside:imp-1");
  });

  it("keeps a wall solid towards the room around it when asked", () => {
    const walled: GameMap = {
      ...islandMap,
      lines: { [wallKey("e", "f")]: { solid: true } },
    };
    expect(validateMap(walled)).toEqual([]);
    expect(
      wallOwners(walled)
        .get(wallKey("e", "f"))
        ?.map((sector) => sector.id),
    ).toEqual(["stage"]);
    const { lines } = buildLevel(walled);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(3);
    expect(lines.find((line) => line.wall === wallKey("e", "f"))).toMatchObject(
      { frontSector: 1, backSector: null },
    );
    expect(parseMapFile(serializeMap(walled))).toEqual(walled);
  });

  it("lets a room sit inside a pillar, closed in by solid wall", () => {
    const cell = addRoom(pillar, [
      { x: 224, y: 224 },
      { x: 288, y: 224 },
      { x: 288, y: 288 },
      { x: 224, y: 288 },
    ]);
    expect(validateMap(cell.map)).toEqual([]);
    expect(containerOf(cell.map, cell.map.sectors[1])).toBeNull();
    expect(sectorAt(cell.map, { x: 256, y: 256 })?.id).toBe(cell.id);
    const { lines } = buildLevel(cell.map);
    expect(lines).toHaveLength(12);
    expect(lines.every((line) => line.backSector === null)).toBe(true);
  });

  it("rejects a room that only partly overlaps another", () => {
    const map = {
      ...islandMap,
      vertices: {
        ...islandMap.vertices,
        f: { x: 600, y: 192 },
        g: { x: 600, y: 320 },
      },
    };
    expect(validateMap(map).map((issue) => issue.id)).toContain(
      "overlap:yard:stage",
    );
  });

  it("rejects two rooms on the same side of one wall", () => {
    const leaning = {
      ...islandMap,
      sectors: [
        islandMap.sectors[0],
        { ...islandMap.sectors[1], vertices: ["a", "b", "g", "h"] },
      ],
    };
    expect(validateMap(leaning).map((issue) => issue.id)).toContain(
      `same-side:${wallKey("a", "b")}`,
    );
    const corner = {
      ...islandMap,
      sectors: [
        islandMap.sectors[0],
        { ...islandMap.sectors[1], vertices: ["a", "b", "c"] },
      ],
    };
    expect(validateMap(corner).map((issue) => issue.id)).toContain(
      `same-side:${wallKey("a", "b")}`,
    );
    expect(() => compileMap(corner)).toThrow("overlaps");
  });

  it("rejects a pillar outside its room and a room around a pillar", () => {
    const outside: GameMap = {
      ...pillar,
      vertices: {
        ...pillar.vertices,
        e: { x: 600, y: 192 },
        f: { x: 700, y: 192 },
        g: { x: 700, y: 320 },
        h: { x: 600, y: 320 },
      },
    };
    expect(validateMap(outside).map((issue) => issue.id)).toContain(
      "pillar-outside:yard",
    );
    const around = addRoom(pillar, [
      { x: 128, y: 128 },
      { x: 384, y: 128 },
      { x: 384, y: 384 },
      { x: 128, y: 384 },
    ]);
    expect(validateMap(around.map).map((issue) => issue.id)).toContain(
      `pillar-inside:yard:${around.id}`,
    );
  });

  it("refuses a pillar with a missing corner in a saved map", () => {
    const broken = {
      ...pillar,
      sectors: [{ ...pillar.sectors[0], holes: [["e", "f", "zz"]] }],
    };
    expect(() => parseMapFile(serializeMap(broken))).toThrow("missing corner");
  });
});

// Which side of start -> end a point is on, as the engine reads it: the
// front is on the right, where this is negative.
function sideOf(
  vertices: { x: number; y: number }[],
  line: { start: number; end: number },
  point: { x: number; y: number },
) {
  const start = vertices[line.start];
  const end = vertices[line.end];
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

describe("lines inside rooms", () => {
  const drawn = defined(
    addDetail(islandMap, [
      { x: 128, y: 400 },
      { x: 384, y: 400 },
    ]),
  );
  const key = wallKey("v1", "v2");

  it("draws a line inside a room with the room on both sides", () => {
    expect(drawn.id).toBe("yard");
    expect(drawn.map.sectors[0].details).toEqual([["v1", "v2"]]);
    expect(validateMap(drawn.map)).toEqual([]);
    expect(
      wallOwners(drawn.map)
        .get(key)
        ?.map((sector) => sector.id),
    ).toEqual(["yard", "yard"]);
    const line = describeLine(drawn.map, key, "yard");
    expect(line.twoSided).toBe(true);
    expect(line.back?.id).toBe("yard");
    expect(line.isBack).toBe(false);
    expect(freeWallAt(drawn.map, key)).toBeNull();
  });

  it("compiles to a two-sided line with the same sector on both sides", () => {
    const grate = updateLineSide(drawn.map, key, "yard", {
      middle: "MIDGRATE",
    });
    const { lines } = buildLevel(grate);
    expect(lines).toHaveLength(9);
    const line = defined(lines.find((item) => item.wall === key));
    expect(line).toMatchObject({ frontSector: 0, backSector: 0 });
    const index = lines.indexOf(line);
    const linedefs = new DataView(lump(grate, "LINEDEFS").buffer);
    expect(linedefs.getInt16(index * 14 + 4, true) & 4).toBe(4);
    const sidedefs = lump(grate, "SIDEDEFS");
    const name = (side: number, at: number) =>
      String.fromCharCode(
        ...sidedefs.slice(side * 30 + at, side * 30 + at + 8),
      ).replace(/\0.*$/, "");
    const front = linedefs.getInt16(index * 14 + 10, true);
    const back = linedefs.getInt16(index * 14 + 12, true);
    expect(name(front, 20)).toBe("MIDGRATE");
    expect(name(back, 20)).toBe("MIDGRATE");
    expect(name(front, 4)).toBe("-");
    expect(name(back, 12)).toBe("-");
    expectConvexLeaves(grate);
  });

  it("carries a walk-over action", () => {
    const wired = setLineTarget(
      updateLine(drawn.map, key, {
        action: { kind: "floor-lower", trigger: "walk", repeat: false, tag: 0 },
      }),
      key,
      "stage",
    );
    expect(validateMap(wired)).toEqual([]);
    expect(
      defined(linesOf(wired).find((item) => item.line.wall === key)).special,
    ).toBe(38);
  });

  it("refuses a line outside a room, on a wall, across a wall or in a door", () => {
    expect(
      addDetail(islandMap, [
        { x: 700, y: 700 },
        { x: 800, y: 800 },
      ]),
    ).toBeNull();
    expect(
      addDetail(lShape, [
        { x: 200, y: 64 },
        { x: 64, y: 200 },
      ]),
    ).toBeNull();
    const onWall: GameMap = {
      ...islandMap,
      sectors: [
        { ...islandMap.sectors[0], details: [["e", "f"]] },
        islandMap.sectors[1],
      ],
    };
    expect(validateMap(onWall).map((issue) => issue.id)).toContain(
      `line-wall:${wallKey("e", "f")}`,
    );
    const across: GameMap = {
      ...islandMap,
      vertices: {
        ...islandMap.vertices,
        l1: { x: 256, y: 128 },
        l2: { x: 256, y: 256 },
      },
      sectors: [
        { ...islandMap.sectors[0], details: [["l1", "l2"]] },
        islandMap.sectors[1],
      ],
    };
    expect(
      validateMap(across).some((issue) => issue.id.startsWith("cross:")),
    ).toBe(true);
    const inDoor: GameMap = {
      ...testMap,
      vertices: {
        ...testMap.vertices,
        d1: { x: 500, y: 120 },
        d2: { x: 500, y: 200 },
      },
      sectors: testMap.sectors.map((sector) =>
        sector.door ? { ...sector, details: [["d1", "d2"]] } : sector,
      ),
    };
    expect(validateMap(inDoor).map((issue) => issue.id)).toContain(
      "line-door-room:sector-4",
    );
  });

  it("refuses a line over a wall and catches one running along a wall", () => {
    expect(
      addDetail(testMap, [
        { x: 384, y: 96 },
        { x: 384, y: 224 },
      ]),
    ).toBeNull();
    const along = defined(
      addDetail(islandMap, [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
      ]),
    );
    expect(along).not.toBeNull();
    expect(validateMap(along.map).map((issue) => issue.id)).toContain(
      `line-wall:${wallKey("a", "v1")}`,
    );
    const leaning: GameMap = {
      ...islandMap,
      vertices: { ...islandMap.vertices, x: { x: 256, y: 0 } },
      sectors: [
        islandMap.sectors[0],
        { ...islandMap.sectors[1], vertices: ["a", "x", "g", "h"] },
      ],
    };
    expect(
      validateMap(leaning).some((issue) => issue.id.startsWith("cross:")),
    ).toBe(true);
  });

  it("flips which way a line faces and leaves the rest of its chain", () => {
    const before = defined(
      buildLevel(drawn.map).lines.find((item) => item.wall === key),
    );
    const flipped = flipDetailLine(drawn.map, "yard", key);
    expect(flipped.sectors[0].details).toEqual([["v2", "v1"]]);
    const after = defined(
      buildLevel(flipped).lines.find((item) => item.wall === key),
    );
    expect(after.start).toBe(before.end);
    expect(after.end).toBe(before.start);
    const chain = defined(
      addDetail(islandMap, [
        { x: 64, y: 400 },
        { x: 192, y: 400 },
        { x: 320, y: 400 },
        { x: 448, y: 400 },
      ]),
    );
    const middle = flipDetailLine(chain.map, "yard", wallKey("v2", "v3"));
    expect(middle.sectors[0].details).toEqual([
      ["v1", "v2"],
      ["v3", "v2"],
      ["v3", "v4"],
    ]);
  });

  it("deletes one line from a chain along with its spare corners", () => {
    const chain = defined(
      addDetail(islandMap, [
        { x: 64, y: 400 },
        { x: 256, y: 400 },
        { x: 448, y: 400 },
      ]),
    );
    expect(chain.map.sectors[0].details).toEqual([["v1", "v2", "v3"]]);
    const cut = removeDetailLine(chain.map, "yard", wallKey("v1", "v2"));
    expect(cut.sectors[0].details).toEqual([["v2", "v3"]]);
    expect(cut.vertices.v1).toBeUndefined();
    const gone = removeDetailLine(cut, "yard", wallKey("v2", "v3"));
    expect(gone.sectors[0].details).toBeUndefined();
    expect(Object.keys(gone.vertices).toSorted()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
    const staged = defined(
      addDetail(islandMap, [
        { x: 224, y: 256 },
        { x: 288, y: 256 },
      ]),
    );
    expect(staged.id).toBe("stage");
    expect(makePillar(staged.map, "stage")).toBeNull();
  });

  it("saves and reopens lines, and refuses one with a single end", () => {
    expect(parseMapFile(serializeMap(drawn.map))).toEqual(drawn.map);
    const broken = {
      ...drawn.map,
      sectors: [
        { ...drawn.map.sectors[0], details: [["v1"]] },
        drawn.map.sectors[1],
      ],
    };
    expect(() => parseMapFile(serializeMap(broken))).toThrow("corners");
  });
});

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

describe("compatibility and raw specials", () => {
  const map: GameMap = {
    ...islandMap,
    complevel: "mbf21",
    sectors: [{ ...islandMap.sectors[0], rawEffect: 32 }, islandMap.sectors[1]],
    lines: {
      [wallKey("e", "f")]: {
        raw: { special: 200, tag: 3 },
        passUse: true,
        soundBlock: true,
        mapped: true,
        secret: true,
      },
    },
    things: [
      ...islandMap.things,
      {
        id: "imp-1",
        kind: "imp",
        x: 64,
        y: 400,
        angle: 0,
        multiplayer: true,
        notDeathmatch: true,
        notCoop: true,
        friendly: true,
      },
    ],
  };

  it("writes raw specials, effects and flags the menus don't have", () => {
    expect(validateMap(map)).toEqual([]);
    const line = defined(
      linesOf(map).find((item) => item.line.wall === wallKey("e", "f")),
    );
    expect(line.special).toBe(200);
    expect(line.tag).toBe(3);
    expect(line.flags & 0x360).toBe(0x360);
    const sectors = new DataView(lump(map, "SECTORS").buffer);
    expect(sectors.getInt16(22, true)).toBe(32);
    const things = new DataView(lump(map, "THINGS").buffer);
    expect(things.getInt16((map.things.length - 1) * 10 + 8, true) & 0xf0).toBe(
      0xf0,
    );
    const summary = inspectWads([{ name: "map.wad", data: compileMap(map) }]);
    expect(summary).toMatchObject({ complevel: "mbf21", declared: true });
    expect(
      inspectWads([{ name: "map.wad", data: compileMap(islandMap) }]).complevel,
    ).toBe("vanilla");
  });

  it("rejects specials and flags past the map's compatibility", () => {
    expect(
      validateMap({ ...map, complevel: undefined }).map((issue) => issue.id),
    ).toEqual([
      `line-level:${wallKey("e", "f")}`,
      "sector-level:yard",
      "thing-level:imp-1",
    ]);
    expect(
      validateMap({ ...map, complevel: "boom" }).map((issue) => issue.id),
    ).toEqual(["thing-level:imp-1"]);
    expect(validateMap({ ...map, complevel: undefined })[0].message).toBe(
      "Wall between Stage and Yard (e|f): needs Boom compatibility, but the map is set to Vanilla.",
    );
    const copies = duplicateThings(map, ["imp-1"]);
    expect(copies.map.things.at(-1)).toMatchObject({
      multiplayer: true,
      notDeathmatch: true,
      notCoop: true,
      friendly: true,
    });
  });

  it("reports a torn room beside a closed tagged room", () => {
    const torn: GameMap = {
      ...islandMap,
      sectors: [
        { ...islandMap.sectors[0], vertices: ["a", "b", "c", "zz"] },
        { ...islandMap.sectors[1], ceiling: 32, tag: 3 },
      ],
    };
    expect(validateMap(torn).map((issue) => issue.id)).toContain(
      "missing:yard",
    );
  });

  it("reports a torn room instead of failing on its raw special", () => {
    const torn: GameMap = {
      ...map,
      sectors: [
        { ...map.sectors[0], vertices: ["a", "b", "c", "zz"] },
        map.sectors[1],
      ],
    };
    expect(
      validateMap({ ...torn, complevel: undefined }).map((issue) => issue.id),
    ).toEqual(
      expect.arrayContaining([
        "missing:yard",
        `line-level:${wallKey("e", "f")}`,
      ]),
    );
  });

  it("saves and reopens them, and refuses an unknown level", () => {
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(() =>
      parseMapFile(serializeMap({ ...map, complevel: "zdoom" as never })),
    ).toThrow("compatibility");
  });
});

describe("wall editing", () => {
  it("splits a wall at a point and gives both halves its settings", () => {
    const marked: GameMap = {
      ...islandMap,
      lines: {
        [wallKey("a", "b")]: { hidden: true, sides: { yard: { offsetX: 40 } } },
      },
      sectors: [
        {
          ...islandMap.sectors[0],
          wallOverrides: { [wallKey("a", "b")]: "BROWN1" },
        },
        islandMap.sectors[1],
      ],
    };
    const split = defined(
      splitWall(marked, wallKey("a", "b"), { x: 250, y: 3 }),
    );
    expect(split.map.vertices[split.id]).toEqual({ x: 248, y: 0 });
    expect(split.map.sectors[0].vertices).toEqual([
      "a",
      split.id,
      "b",
      "c",
      "d",
    ]);
    expect(split.map.lines?.[wallKey("a", split.id)]).toEqual({
      hidden: true,
      sides: { yard: { offsetX: 40 } },
    });
    expect(split.map.lines?.[wallKey(split.id, "b")]).toEqual({
      hidden: true,
      sides: { yard: { offsetX: 288 } },
    });
    // The same room drawn the other way round reads its walls the same way.
    const reversed = defined(
      splitWall(
        {
          ...marked,
          sectors: [
            { ...marked.sectors[0], vertices: ["a", "d", "c", "b"] },
            marked.sectors[1],
          ],
        },
        wallKey("a", "b"),
        { x: 250, y: 3 },
      ),
    );
    expect(reversed.map.lines?.[wallKey("a", reversed.id)]?.sides).toEqual({
      yard: { offsetX: 40 },
    });
    expect(reversed.map.lines?.[wallKey(reversed.id, "b")]?.sides).toEqual({
      yard: { offsetX: 288 },
    });
    // The yard reads the stage's wall from its far end, as the back side.
    const around = defined(
      splitWall(
        {
          ...islandMap,
          lines: { [wallKey("e", "f")]: { sides: { yard: { offsetX: 40 } } } },
        },
        wallKey("e", "f"),
        { x: 256, y: 192 },
      ),
    );
    expect(around.map.lines?.[wallKey("f", around.id)]?.sides).toEqual({
      yard: { offsetX: 40 },
    });
    expect(around.map.lines?.[wallKey("e", around.id)]?.sides).toEqual({
      yard: { offsetX: 104 },
    });
    expect(split.map.lines?.[wallKey("a", "b")]).toBeUndefined();
    expect(split.map.sectors[0].wallOverrides).toEqual({
      [wallKey("a", split.id)]: "BROWN1",
      [wallKey(split.id, "b")]: "BROWN1",
    });
    expect(validateMap(split.map)).toEqual([]);
    expect(splitWall(islandMap, wallKey("a", "b"), { x: 2, y: 0 })).toBeNull();
    const item = testMap.switches[0];
    expect(
      splitWall(testMap, wallKey(item.from, item.to), { x: 0, y: 0 }),
    ).toBeNull();
  });

  it("splits a pillar's wall and a shared wall in every outline", () => {
    const pillar = defined(makePillar(islandMap, "stage"));
    const split = defined(
      splitWall(pillar, wallKey("e", "f"), { x: 256, y: 192 }),
    );
    expect(pillar.sectors[0].holes?.[0]).toHaveLength(4);
    expect(split.map.sectors[0].holes?.[0]).toHaveLength(5);
    const shared = defined(
      splitWall(testMap, wallKey("v3", "v4"), { x: 384, y: 160 }),
    );
    expect(shared.map.sectors[0].vertices).toContain(shared.id);
    expect(shared.map.sectors[1].vertices).toContain(shared.id);
    expect(validateMap(shared.map)).toEqual([]);
  });

  it("lets the surviving wall keep its settings when a dropped one lands on it", () => {
    const clash: GameMap = {
      vertices: {
        v1: { x: 0, y: 0 },
        v2: { x: 64, y: 0 },
        v3: { x: 64, y: 64 },
        v4: { x: 0, y: 64 },
        v15: { x: 0, y: 0 },
        v6: { x: 32, y: -64 },
      },
      sectors: [
        {
          ...islandMap.sectors[0],
          id: "top",
          vertices: ["v1", "v2", "v3", "v4"],
        },
        { ...islandMap.sectors[0], id: "low", vertices: ["v15", "v2", "v6"] },
      ],
      things: [],
      switches: [],
      lines: {
        [wallKey("v1", "v2")]: { hidden: true },
        [wallKey("v15", "v2")]: { blocksEnemies: true },
      },
    };
    const joined = mergeCorners(clash, ["v1"]);
    expect(joined.lines).toEqual({
      [wallKey("v15", "v2")]: { blocksEnemies: true },
    });
    expect(joined.sectors[0].vertices).toEqual(["v15", "v2", "v3", "v4"]);
  });

  it("leaves a corner dropped on a far corner of its own room alone", () => {
    const folded: GameMap = {
      ...islandMap,
      vertices: { ...islandMap.vertices, b: { x: 0, y: 512 } },
    };
    expect(mergeCorners(folded, ["b"])).toBe(folded);
  });

  it("joins a corner dropped onto another and rekeys its walls", () => {
    const beside: GameMap = {
      ...islandMap,
      vertices: {
        ...islandMap.vertices,
        p: { x: 512, y: 0 },
        q: { x: 768, y: 0 },
        r: { x: 768, y: 512 },
        s: { x: 512, y: 512 },
      },
      sectors: [
        ...islandMap.sectors,
        {
          ...islandMap.sectors[0],
          id: "annex",
          name: "Annex",
          vertices: ["p", "q", "r", "s"],
        },
      ],
      lines: { [wallKey("p", "q")]: { hidden: true } },
    };
    const joined = mergeCorners(beside, ["p", "s"]);
    expect(joined.vertices.p).toBeUndefined();
    expect(joined.vertices.s).toBeUndefined();
    expect(joined.sectors[2].vertices).toEqual(["b", "q", "r", "c"]);
    expect(joined.lines).toEqual({ [wallKey("b", "q")]: { hidden: true } });
    expect(
      wallOwners(joined)
        .get(wallKey("b", "c"))
        ?.map((sector) => sector.id),
    ).toEqual(["yard", "annex"]);
    expect(validateMap(joined)).toEqual([]);
    const shorter = mergeCorners(
      { ...testMap, vertices: { ...testMap.vertices, v16: { x: 384, y: 0 } } },
      ["v16"],
    );
    expect(shorter.vertices.v16).toBeUndefined();
    expect(shorter.sectors[0].vertices).toEqual([
      "v1",
      "v15",
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
    ]);
    expect(shorter.switches[0]).toMatchObject({ from: "v15", to: "v2" });
    expect(validateMap(shorter)).toEqual([]);
  });
});

describe("grid sizes", () => {
  it("snaps to the chosen grid, down to single units", () => {
    expect(snapPoint({ x: 13, y: 19 }, 16)).toEqual({ x: 16, y: 16 });
    expect(snapPoint({ x: 13, y: 19 }, 1)).toEqual({ x: 13, y: 19 });
    expect(snapPoint({ x: 13, y: 19 })).toEqual({ x: 16, y: 16 });
  });

  it("keeps rooms, lines, things and switches on the chosen grid", () => {
    const room = addRoom(
      islandMap,
      [
        { x: 34, y: 402 },
        { x: 98, y: 402 },
        { x: 98, y: 466 },
        { x: 34, y: 466 },
      ],
      {},
      2,
    );
    expect(room.map.vertices[room.map.sectors[2].vertices[0]]).toEqual({
      x: 34,
      y: 402,
    });
    expect(validateMap(room.map)).toEqual([]);
    const line = defined(
      addDetail(
        islandMap,
        [
          { x: 129, y: 401 },
          { x: 385, y: 401 },
        ],
        1,
      ),
    );
    expect(line.map.vertices.v1).toEqual({ x: 129, y: 401 });
    const thing = addThing(islandMap, "imp", { x: 65, y: 67 }, 0, 4);
    expect(thing.map.things.at(-1)).toMatchObject({ x: 64, y: 68 });
    const pillar = defined(makePillar(islandMap, "stage"));
    const pressed = addSwitch(
      pillar,
      defined(freeWallAt(pillar, wallKey("e", "f"))),
      { x: 250, y: 192 },
      null,
      1,
    );
    expect(
      pressed.map.sectors[0].holes?.[0].map(
        (id) => pillar.vertices[id] ?? pressed.map.vertices[id],
      ),
    ).toContainEqual({ x: 218, y: 192 });
  });

  it("keeps already placed points where they are", () => {
    const fine: GameMap = {
      ...islandMap,
      things: [
        ...islandMap.things,
        { id: "imp-1", kind: "imp", x: 13, y: 19, angle: 0 },
      ],
    };
    const copies = duplicateThings(fine, ["imp-1"]);
    expect(copies.map.things.at(-1)).toMatchObject({ x: 29, y: 35 });
    const narrow: GameMap = {
      ...lShape,
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 120, y: 0 },
        c: { x: 120, y: 120 },
        d: { x: 0, y: 120 },
      },
      sectors: [{ ...lShape.sectors[0], vertices: ["a", "b", "c", "d"] }],
    };
    const wide = addSwitch(
      narrow,
      defined(freeWallAt(narrow, wallKey("a", "b"))),
      { x: 80, y: 0 },
      null,
      64,
    );
    expect(validateMap({ ...wide.map, switches: [] })).toEqual([]);
    expect(
      Object.values(wide.map.vertices).every(({ x }) => x >= 0 && x <= 120),
    ).toBe(true);
  });

  it("snaps corners to the chosen grid", () => {
    const off = {
      ...islandMap,
      vertices: { ...islandMap.vertices, e: { x: 195, y: 190 } },
    };
    expect(snapCorners(off, ["e"], 16).vertices.e).toEqual({ x: 192, y: 192 });
    expect(snapCorners(off, ["e"], 1).vertices.e).toEqual({ x: 195, y: 190 });
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
    expect(validateMap(defined(added).map)).toEqual([]);
    const { lines } = buildLevel(defined(added).map);
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

  it("warns about doors stretched deeper than a door is built", () => {
    const keys = partKeys(
      starterMap,
      selectedParts(starterMap, [], "sector-3"),
    );
    const shrunk = defined(
      transformParts(starterMap, keys, { kind: "scale", factor: 0.5 }, 32),
    );
    const { errors, warnings } = inspectMap(shrunk);
    expect(errors).toEqual([]);
    expect(
      warnings.filter((issue) => issue.id.startsWith("door-deep")),
    ).toEqual([
      expect.objectContaining({
        id: "door-deep:sector-4",
        message:
          "Arena door: the door is 144 deep. A door is usually 16 to 32, and no more than 96.",
      }),
      expect.objectContaining({ id: "door-deep:sector-7" }),
    ]);
    expect(checkMap(shrunk)).toContainEqual(
      expect.objectContaining({
        id: "door-deep:sector-4",
        severity: "warning",
      }),
    );
  });

  it("measures a wide door's depth across it, not along a split face", () => {
    const door = (
      split: { x: number; y: number },
      slope: number,
      wrapped = false,
    ): GameMap => ({
      ...blankMap,
      vertices: {
        a: { x: 0, y: 0 },
        b: split,
        c: { x: 256, y: slope },
        d: { x: 256, y: slope + 16 },
        e: { x: 0, y: 16 },
        f: { x: 0, y: -128 },
        g: { x: split.x, y: -128 },
        h: { x: 256, y: -128 },
        i: { x: 256, y: 160 },
        j: { x: 0, y: 160 },
        k: { x: -64, y: -128 },
        l: { x: -64, y: 16 },
      },
      sectors: [
        {
          ...testMap.sectors[0],
          id: "west",
          vertices: wrapped
            ? ["k", "g", "b", "a", "e", "l"]
            : ["f", "g", "b", "a"],
        },
        { ...testMap.sectors[0], id: "east", vertices: ["g", "h", "c", "b"] },
        { ...testMap.sectors[0], id: "south", vertices: ["e", "d", "i", "j"] },
        {
          ...testMap.sectors[3],
          id: "door",
          vertices: ["a", "b", "c", "d", "e"],
          door: { opensBy: "use", closes: true, texture: "DOOR3" },
        },
      ],
      things: [{ id: "player-1", kind: "player", x: 64, y: -64, angle: 0 }],
      switches: [],
    });
    for (const map of [
      door({ x: 128, y: 0 }, 0),
      door({ x: 128, y: 33 }, 64),
    ]) {
      const { errors, warnings } = inspectMap(map);
      expect(errors).toEqual([]);
      expect(warnings.map((issue) => issue.id)).not.toContain("door-deep:door");
    }
  });

  it("finds no deep doors in the starter and featured maps", () => {
    for (const map of [starterMap, ...featuredMaps.map((item) => item.map)]) {
      const ids = inspectMap(map).warnings.map((issue) => issue.id);
      expect(ids.filter((id) => id.startsWith("door-deep"))).toEqual([]);
    }
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

function updateSectorCeiling(map: GameMap, id: string, ceiling: number) {
  return {
    ...map,
    sectors: map.sectors.map((sector) =>
      sector.id === id ? { ...sector, ceiling } : sector,
    ),
  };
}

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
  const door = defined(testMap.sectors[doorIndex].door);

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
    const item = defined(defined(added).map.switches.at(-1));
    const a = defined(added).map.vertices[item.from];
    const b = defined(added).map.vertices[item.to];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBe(64);
    expect(validateMap(defined(added).map)).toEqual([]);
  });

  it("disconnects switches when a door becomes a room again", () => {
    const map = setRoomDoor(testMap, "sector-4", undefined);
    expect(map.switches[0].door).toBeNull();
  });
});

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
    const tag = defined(defined(map.lines)[openWall].action).tag;
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

  it("words a lost tag for what the action does", () => {
    const message = (patch: Partial<LineAction>) =>
      validateMap(
        updateLine(testMap, openWall, { action: lowerFloor(patch) }),
      ).find((issue) => issue.id === `line-tag:${openWall}`);
    expect(message({ tag: 99 })?.message).toContain(
      "the sector this action moves no longer has its tag.",
    );
    const teleport = message({ kind: "teleport", tag: 99 });
    expect(teleport?.message).toContain(
      "no room is this teleporter's destination.",
    );
    expect(teleport?.target).toBe(openWall);
    expect(message({ kind: "light-max", tag: 99 })?.message).toContain(
      "the sector whose light it changes no longer has its tag.",
    );
  });

  it("warns about a floor raise that can't rise", () => {
    const raise = (map: GameMap, target = "sector-2") => {
      const raised = setLineTarget(
        updateLine(map, openWall, {
          action: {
            kind: "floor-raise",
            trigger: "shoot",
            repeat: false,
            tag: 0,
          },
        }),
        openWall,
        target,
      );
      return inspectMap(raised).warnings.find(
        (issue) => issue.id === `line-stuck:${openWall}`,
      );
    };
    expect(raise(testMap)?.message).toBe(
      "Wall between Start room and Corridor (v3|v4): the floor of Corridor can't rise: it stops at the lowest ceiling next to it, Arena door, closed at -16.",
    );
    expect(raise(setRoomDoor(testMap, "sector-4", undefined))).toBeUndefined();
    expect(
      raise(updateSector(testMap, "sector-2", { floor: 0 }))?.message,
    ).toBe(
      "Wall between Start room and Corridor (v3|v4): the floor of Corridor drops instead of rising: it goes to the lowest ceiling next to it, Arena door, closed at -16.",
    );
    expect(raise(testMap, "sector-4")?.message).toBe(
      "Wall between Start room and Corridor (v3|v4): the floor of Arena door can't rise: it stops at its own ceiling, closed at -16.",
    );
  });

  it("warns about a press-to-open door with no door behind its line", () => {
    const pressed = {
      kind: "door-raise",
      trigger: "door",
      repeat: true,
      tag: 0,
    } as const;
    const ids = (map: GameMap) => {
      const { errors, warnings } = inspectMap(map);
      return {
        errors: errors.map((issue) => issue.id),
        warnings: warnings.map((issue) => issue.id),
      };
    };
    // The corridor behind this line isn't a door, so pressing would move it.
    const open = ids(updateLine(testMap, openWall, { action: pressed }));
    expect(open.errors).toEqual([]);
    expect(open.warnings).toContain(`line-doorless:${openWall}`);
    expect(describeLine(testMap, openWall, "sector-1").doorBehind).toBe(false);

    const doorWall = wallKey("v13", "v14");
    expect(describeLine(testMap, doorWall, "sector-2").doorBehind).toBe(true);
    const door = ids(updateLine(testMap, doorWall, { action: pressed }));
    expect(door.warnings).not.toContain(`line-doorless:${doorWall}`);

    // A pressed Boom door does the same to the room behind it.
    const boomDoor = defined(generalizedClass("door")).start;
    const boom = (wall: string) =>
      ids({
        ...updateLine(testMap, wall, { raw: { special: boomDoor, tag: 0 } }),
        complevel: "boom",
      });
    expect(boom(openWall).errors).toEqual([]);
    expect(boom(openWall).warnings).toContain(`line-doorless:${openWall}`);
    expect(boom(doorWall).warnings).not.toContain(`line-doorless:${doorWall}`);
    // Started as a switch instead, it waits for a sector to open.
    const switched = ids({
      ...updateLine(testMap, openWall, {
        raw: {
          special: newGeneralized(defined(generalizedClass("door")), openLine),
          tag: 0,
        },
      }),
      complevel: "boom",
    });
    expect(switched.errors).toEqual([]);
    expect(switched.warnings).toEqual([`line-target:${openWall}`]);

    // A line inside a room has the room itself behind it.
    const inside = defined(
      addDetail(testMap, [
        { x: 640, y: 128 },
        { x: 768, y: 128 },
      ]),
    ).map;
    const [from, to] = defined(inside.sectors[2].details)[0];
    const innerWall = wallKey(from, to);
    expect(describeLine(inside, innerWall, "sector-3")).toMatchObject({
      twoSided: true,
      doorBehind: false,
    });
    expect(
      triggersFor("door-raise", describeLine(inside, innerWall, "sector-3")),
    ).toEqual(["switch", "walk"]);
    expect(
      ids(updateLine(inside, innerWall, { action: pressed })).warnings,
    ).toContain(`line-doorless:${innerWall}`);
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
    const added = addSwitch(map, defined(freeWallNear(map, at, 32)), at);
    const item = defined(added.map.switches.at(-1));
    expect(added.map.lines?.[wallKey(item.from, item.to)]).toEqual({ action });
    const halves = Object.values(defined(added.map.lines)).filter(
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
    const added = defined(addSwitchInRoom(map, "sector-1", "sector-4"));
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
    expect(defined(defined(map.lines)[openWall].action).tag).toBe(1);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("only offers triggers the line can use", () => {
    expect(triggersFor("door-raise", solidLine)).toEqual(["switch"]);
    // Pressing a line with no door behind it would move the room there.
    expect(triggersFor("door-raise", openLine)).toEqual(["switch", "walk"]);
    expect(triggersFor("door-raise", doorLine)).toContain("door");
    expect(newLineAction(openLine, "door-raise").trigger).toBe("switch");
    expect(newLineAction(doorLine, "door-raise").trigger).toBe("door");
    expect(
      fitLineAction(
        { kind: "exit", trigger: "door", repeat: true, tag: 0 },
        doorLine,
      ),
    ).toMatchObject({ trigger: "switch", repeat: false });
    const pressed = {
      kind: "door-raise",
      trigger: "door",
      repeat: true,
      tag: 0,
    } as const;
    expect(triggerChoices(pressed, openLine)).toEqual([
      "door",
      "switch",
      "walk",
    ]);
    // A trigger the line no longer suits is listed first, ahead of the rest.
    expect(
      triggerChoices(
        { kind: "floor-lower", trigger: "walk", repeat: true, tag: 0 },
        solidLine,
      ),
    ).toEqual(["walk", "switch"]);
    expect(
      triggerChoices(
        { kind: "floor-lower", trigger: "walk", repeat: true, tag: 0 },
        openLine,
      ),
    ).toEqual(["switch", "walk"]);
  });

  it("leaves an old press-to-open trigger alone when its key changes", () => {
    const pressed = {
      kind: "door-raise",
      trigger: "door",
      repeat: true,
      tag: 0,
    } as const;
    expect(
      fitLineAction({ ...pressed, key: "blue" }, openLine, "door"),
    ).toEqual({ ...pressed, key: "blue" });
    // Choosing another kind fits the trigger to the line again.
    expect(
      fitLineAction({ ...pressed, kind: "door-open" }, openLine),
    ).toMatchObject({ trigger: "switch", key: undefined });
    expect(
      fitLineAction({ ...pressed, trigger: "walk" }, openLine, "door"),
    ).toMatchObject({ trigger: "walk" });
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
    const added = addSwitch(map, defined(freeWallNear(map, at, 32)), at);
    expect(added.map.lines?.[wall]).toBeUndefined();
    expect(
      Object.values(added.map.lines ?? {}).filter((line) => line.hidden),
    ).toHaveLength(2);
  });
});

function lineOn(map: GameMap, wall: string) {
  return defined(linesOf(map).find((item) => item.line.wall === wall));
}

function lineIssues(wall: string, patch: Partial<LineAction>) {
  return validateMap(
    updateLine(testMap, wall, { action: lowerFloor(patch) }),
  ).map((issue) => issue.id);
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
    const copy = defined(copies.map.things.at(-1));
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
    expect(view && getCanStand(testMap, view.from)).toBe(true);
    expect(
      viewOfTarget(testMap, {
        kind: "room",
        sector: "sector-4",
        point: null,
      }),
    ).toBeNull();
  });
});

describe("thing settings", () => {
  it("adds missing co-op starts beside player 1", () => {
    const map = addPlayerStarts(testMap, 4);
    const first = defined(map.things.find((thing) => thing.kind === "player"));
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

  it("names a line by its wall, so its message stays the same after an earlier wall is split", () => {
    const locked = updateLine(testMap, wallKey("v3", "v4"), {
      action: {
        kind: "door-raise",
        trigger: "door",
        repeat: true,
        key: "blue",
        tag: 0,
      },
    });
    const message = (map: GameMap) =>
      validateMap(map).find(
        (issue) => issue.id === `line-key:${wallKey("v3", "v4")}`,
      )?.message;
    expect(message(locked)).toBe(
      "Wall between Start room and Corridor (v3|v4): place the blue key on every difficulty.",
    );
    const at = { x: 80, y: 0 };
    const added = addSwitch(locked, defined(freeWallNear(locked, at, 32)), at);
    expect(added.map.switches).toHaveLength(testMap.switches.length + 1);
    expect(message(added.map)).toBe(message(locked));
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
    const start = defined(
      testMap.things.find((thing) => thing.kind === "player"),
    );
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
      keysMissing: 1,
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

  it("counts the keys locked lines ask for apart from missing ones", () => {
    const lock = (key: "blue" | "red") => ({
      kind: "door-raise" as const,
      trigger: "door" as const,
      repeat: true,
      key,
      tag: 0,
    });
    const locked = updateLine(
      updateLine(
        {
          ...testMap,
          things: [
            ...testMap.things,
            { id: "k", kind: "blue-key", x: 192, y: 64, angle: 0 },
          ],
        },
        wallKey("v3", "v4"),
        { action: lock("blue") },
      ),
      wallKey("v13", "v14"),
      { action: lock("blue") },
    );
    expect(mapBalance(locked, "medium")).toMatchObject({
      keys: 1,
      keysNeeded: 1,
      keysMissing: 0,
    });
    const both = updateLine(locked, wallKey("v13", "v14"), {
      action: lock("red"),
    });
    expect(mapBalance(both, "medium")).toMatchObject({
      keysNeeded: 2,
      keysMissing: 1,
    });
  });
});

function thingFlagsOf(map: GameMap, index: number) {
  return new DataView(lump(map, "THINGS").buffer).getInt16(
    index * 10 + 8,
    true,
  );
}

describe("map check", () => {
  it("separates warnings from blocking errors", () => {
    const checks = checkMap(testMap);
    expect(checks.every((issue) => issue.severity === "warning")).toBe(true);
    expect(checks.map((issue) => issue.id)).toContain("no-exit");
    expect(validateMap(testMap)).toEqual([]);
  });

  it("counts a floor that ends the level as an exit", () => {
    const ending: GameMap = {
      ...testMap,
      sectors: testMap.sectors.map((sector, index) =>
        index === 0 ? { ...sector, effect: "damage-20-exit" } : sector,
      ),
    };
    expect(checkIds(ending)).not.toContain("no-exit");
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
    const issue = defined(
      validateMap(low).find((item) => item.id.startsWith("height")),
    );
    expect(validateMap(defined(fixIssue(low, issue)))).toEqual([]);
    const unwired = { ...testMap, switches: [] };
    const door = defined(
      validateMap(unwired).find((item) => item.id.startsWith("door-unwired")),
    );
    expect(fixIssue(unwired, door)).toBeNull();
    const wall = wallKey("v1", "v15");
    const walking = updateLine(testMap, wall, {
      action: { kind: "exit", trigger: "walk", repeat: false, tag: 0 },
    });
    const walkIssue = defined(
      validateMap(walking).find((item) => item.id.startsWith("line-walk")),
    );
    const fixedWalk = defined(fixIssue(walking, walkIssue));
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
      action: newLineAction(solidLine, "teleport"),
    });
    expect(() => parseMapFile(serializeMap(map))).not.toThrow();
    const issue = defined(
      validateMap(map).find((item) => item.id.startsWith("line-walk")),
    );
    expect(issue).toBeDefined();
    expect(fixIssue(map, issue)?.lines?.["v1|v15"]?.action).toBeUndefined();
  });

  it("builds a line from the room chosen as its front", () => {
    const front = (map: GameMap) => {
      const { lines, sectors } = buildLevel(map);
      return sectors[
        defined(lines.find((line) => line.wall === "v3|v4")).frontSector
      ].id;
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
      const lines = defined(
        compileLumps(map).find((lump) => lump.name === "LINEDEFS"),
      );
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
          action: newLineAction(openLine, "floor-lower"),
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
      "Platforms",
      "Crushers",
      "Stairs",
      "Teleporters",
      "Lights",
      "Level",
    ]);
    const floors = defined(groups.find((group) => group.label === "Floors"));
    expect(floors.items[0]).toMatchObject({
      label: "Floor: lower to lowest nearby floor",
      short: "Lower to lowest nearby floor",
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

function checkIds(map: GameMap) {
  return checkMap(map).map((issue) => issue.id);
}

describe("doors line by line", () => {
  const useDoor: GameMap = {
    ...testMap,
    switches: [],
    sectors: testMap.sectors.map((sector) =>
      sector.id === "sector-4"
        ? {
            ...sector,
            door: { opensBy: "use", closes: true, texture: "BIGDOOR2" },
          }
        : sector,
    ),
  };
  const corridorSide = wallKey("v13", "v14");
  const arenaSide = wallKey("v7", "v8");
  const tracks = [wallKey("v13", "v7"), wallKey("v8", "v14")];

  function sidesOf(map: GameMap) {
    const linedefs = new DataView(lump(map, "LINEDEFS").buffer);
    const sidedefs = lump(map, "SIDEDEFS");
    const text = new TextDecoder("latin1");
    const name = (at: number) =>
      text.decode(sidedefs.subarray(at, at + 8)).replace(/\0+$/, "");
    const side = (index: number) =>
      index === 0xffff
        ? null
        : {
            upper: name(index * 30 + 4),
            lower: name(index * 30 + 12),
            middle: name(index * 30 + 20),
            sector: new DataView(sidedefs.buffer).getInt16(
              index * 30 + 28,
              true,
            ),
          };
    return buildLevel(map).lines.map((line, index) => ({
      wall: line.wall,
      front: side(linedefs.getUint16(index * 14 + 10, true)),
      back: side(linedefs.getUint16(index * 14 + 12, true)),
    }));
  }

  it("lets each line into a door open it its own way or not at all", () => {
    const map: GameMap = {
      ...useDoor,
      lines: {
        [corridorSide]: { shut: true },
        [arenaSide]: {
          action: {
            kind: "door-open",
            trigger: "door",
            repeat: false,
            tag: 5,
          },
        },
        [tracks[0]]: { lowerFixed: false },
      },
    };
    expect(validateMap(map)).toEqual([]);
    const lines = linesOf(map);
    const byWall = (wall: string) =>
      defined(lines.find((item) => item.line.wall === wall));
    expect(byWall(corridorSide)).toMatchObject({ special: 0, tag: 0 });
    expect(byWall(arenaSide)).toMatchObject({ special: 31, tag: 5 });
    expect(
      linesOf(useDoor).find((item) => item.line.wall === corridorSide),
    ).toMatchObject({ special: 1 });
    // Door tracks stay pegged to the floor unless the line opts out.
    expect(byWall(tracks[0]).flags & 0x10).toBe(0);
    expect(byWall(tracks[1]).flags & 0x10).toBe(0x10);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("reports a door no line opens unless something else does", () => {
    const shut: GameMap = {
      ...useDoor,
      lines: { [corridorSide]: { shut: true }, [arenaSide]: { shut: true } },
    };
    const shutDoors = (map: GameMap) =>
      inspectMap(map).warnings.map((issue) => issue.id);
    expect(validateMap(shut)).toEqual([]);
    expect(shutDoors(shut)).toEqual(["door-shut:sector-4"]);
    // A line with its own action gives up the door's special.
    const exits: GameMap = {
      ...useDoor,
      lines: {
        [corridorSide]: { shut: true },
        [arenaSide]: {
          action: { kind: "exit", trigger: "switch", repeat: false, tag: 0 },
        },
      },
    };
    expect(shutDoors(exits)).toEqual(["door-shut:sector-4"]);
    const wired: GameMap = {
      ...shut,
      switches: [{ ...testMap.switches[0], door: "sector-4" }],
    };
    expect(shutDoors(wired)).toEqual([]);
    const opened: GameMap = {
      ...shut,
      sectors: shut.sectors.map((sector) =>
        sector.id === "sector-4" ? { ...sector, tag: 7 } : sector,
      ),
      lines: {
        ...shut.lines,
        [wallKey("v1", "v15")]: {
          action: {
            kind: "door-raise",
            trigger: "switch",
            repeat: true,
            tag: 7,
          },
        },
      },
    };
    expect(shutDoors(opened)).toEqual([]);
    const byRaw: GameMap = {
      ...opened,
      lines: {
        ...shut.lines,
        [wallKey("v1", "v15")]: { raw: { special: 63, tag: 7 } },
      },
    };
    expect(shutDoors(byRaw)).toEqual([]);
  });

  it("paints one face of a door or the whole door", () => {
    const face = surfaceKey({
      kind: "wall",
      sector: "sector-3",
      wall: arenaSide,
      part: "upper",
    });
    const painted = paintSurface(useDoor, face, "BIGDOOR1");
    expect(painted.lines?.[arenaSide]?.sides?.["sector-3"]?.upper).toBe(
      "BIGDOOR1",
    );
    expect(describeSurface(painted, face)?.texture).toBe("BIGDOOR1");
    expect(describeSurface(useDoor, face)?.texture).toBe("BIGDOOR2");
    const sides = defined(
      sidesOf(painted).find((item) => item.wall === arenaSide),
    );
    expect(
      [sides.front, sides.back].find((side) => side?.sector === 2)?.upper,
    ).toBe("BIGDOOR1");
    expect(
      [sides.front, sides.back].find((side) => side?.sector === 3)?.upper,
    ).toBe("BIGDOOR2");
    // Painting the door's own texture on a face takes the override away, and
    // painting the whole door changes every face.
    expect(paintSurface(painted, face, "BIGDOOR2").lines).toBeUndefined();
    const whole = paintSurface(painted, face, "BIGDOOR4", true);
    expect(whole.sectors[3].door?.texture).toBe("BIGDOOR4");
    expect(whole.lines).toBeUndefined();
    expect(setDoorTexture(painted, "sector-4", "BIGDOOR4")).toEqual(whole);
    const small = paintSurface(useDoor, face, "DOOR1");
    expect(parseMapFile(serializeMap(small))).toEqual(small);
  });

  it("builds a Boom special from its fields and aims it at a sector", () => {
    const wall = wallKey("e", "f");
    const start = defined(generalizedClass("floor")).start;
    const crusher = defined(generalizedClass("crusher"));
    expect(newGeneralized(crusher, openLine)).toBe(crusher.start);
    expect(
      generalizedTrigger(newGeneralized(crusher, solidLine)),
    ).toMatchObject({ trigger: "switch" });
    // A pressed Boom door opens whatever is behind its line.
    const door = defined(generalizedClass("door"));
    expect(newGeneralized(door, doorLine)).toBe(door.start);
    expect(generalizedTrigger(newGeneralized(door, openLine))).toEqual({
      trigger: "switch",
      repeat: true,
    });
    const lift = defined(generalizedClass("lift"));
    expect(newGeneralized(lift, openLine)).toBe(lift.start);
    const raw = updateLine(islandMap, wall, {
      raw: { special: start, tag: 0 },
    });
    const aimed = setLineTarget(raw, wall, "yard");
    const tag = defined(aimed.sectors[0].tag);
    expect(tag).toBeGreaterThan(0);
    expect(aimed.lines?.[wall]?.raw).toEqual({ special: start, tag });
    expect(validateMap(aimed).map((issue) => issue.id)).toEqual([
      `line-level:${wall}`,
    ]);
    const boom: GameMap = { ...aimed, complevel: "boom" };
    expect(validateMap(boom)).toEqual([]);
    expect(linesOf(boom).find((item) => item.line.wall === wall)).toMatchObject(
      { special: start, tag },
    );
    // Nothing walks over or presses the back of a wall with nothing behind.
    const trigger = defined(
      generalizedFields(start).find((field) => field.id === "trigger"),
    );
    const outerWall = wallKey("a", "b");
    const walked: GameMap = {
      ...boom,
      lines: {
        [outerWall]: { raw: { special: withField(start, trigger, 0), tag } },
      },
    };
    expect(validateMap(walked).map((issue) => issue.id)).toEqual([
      `line-walk:${outerWall}`,
    ]);
    const pressed: GameMap = {
      ...boom,
      lines: {
        [outerWall]: { raw: { special: withField(start, trigger, 7), tag } },
      },
    };
    expect(validateMap(pressed).map((issue) => issue.id)).toEqual([
      `line-door:${outerWall}`,
    ]);
    expect(setLineTarget(aimed, wall, null).lines?.[wall]?.raw?.tag).toBe(0);
  });
});

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

describe("the game's own things and textures", () => {
  const doom = games.doom;
  const names = {
    walls: ["STARTAN3", "BROWN1", "METAL", "BIGDOOR2", "SW1STRTN"],
    flats: [
      "FLOOR4_8",
      "FLAT5_4",
      "FLOOR5_1",
      "CEIL3_5",
      "CEIL5_1",
      "TLITE6_4",
    ],
    middles: [],
    custom: [],
    textures: ["STARTAN3", "BROWN1", "METAL", "BIGDOOR2", "SW1STRTN"],
  };

  const umapinfo = (wad: Uint8Array) => {
    const info = readLumps({ name: "e.wad", data: wad }).find(
      (lump) => lump.name === "UMAPINFO",
    );
    return info ? new TextDecoder().decode(info.data) : null;
  };
  const nameless: GameMap = { ...testMap, name: undefined };

  it("chains a Doom 1 episode's maps past the eighth with UMAPINFO", () => {
    const lumpNames = (wad: Uint8Array) =>
      readLumps({ name: "e.wad", data: wad }).map((lump) => lump.name);
    const doomOne = compileEpisode([
      { slot: "E1M7", map: nameless },
      { slot: "E1M9", map: nameless },
      { slot: "E2M1", map: nameless },
    ]);
    // A gap plays the game's own level, which then carries on to the next
    // slot like any other.
    expect(umapinfo(doomOne)).toBe(
      [
        'MAP E1M7\n{\n  next = "E1M8"\n}\n',
        'MAP E1M8\n{\n  next = "E1M9"\n}\n',
        'MAP E1M9\n{\n  next = "E2M1"\n}\n',
      ].join("\n"),
    );
    expect(lumpNames(doomOne).at(-1)).toBe("COMPLVL");
    // The game's last slot ends the game, since nothing follows it.
    expect(
      umapinfo(
        compileEpisode(
          [
            { slot: "E4M8", map: nameless },
            { slot: "E4M9", map: { ...testMap, name: "Last" } },
          ],
          games.doom,
        ),
      ),
    ).toBe(
      [
        'MAP E4M8\n{\n  next = "E4M9"\n}\n',
        'MAP E4M9\n{\n  endgame = true\n  levelname = "Last"\n}\n',
      ].join("\n"),
    );
    expect(
      umapinfo(
        compileEpisode(
          [{ slot: "MAP32", map: { ...testMap, name: "Last" } }],
          games.doom2,
        ),
      ),
    ).toBe('MAP MAP32\n{\n  endgame = true\n  levelname = "Last"\n}\n');
    // The engine has no E1M10, so a last ninth map goes on to E2M1.
    expect(
      umapinfo(
        compileEpisode([
          { slot: "E1M8", map: nameless },
          { slot: "E1M9", map: nameless },
        ]),
      ),
    ).toBe(
      [
        'MAP E1M8\n{\n  next = "E1M9"\n}\n',
        'MAP E1M9\n{\n  next = "E2M1"\n}\n',
      ].join("\n"),
    );
    const doomTwo = compileEpisode([
      { slot: "MAP01", map: nameless },
      { slot: "MAP02", map: nameless },
    ]);
    expect(lumpNames(doomTwo)).not.toContain("UMAPINFO");
  });

  it("writes each map's name, par, music, sky and text into UMAPINFO", () => {
    const wad = compileEpisode([
      {
        slot: "MAP01",
        map: { ...testMap, name: 'The "Entry"' },
        par: 95,
        music: "D_RUNNIN",
        sky: "SKY2",
        intertext: "You made it out.\n\nNow the real work starts.",
      },
      { slot: "MAP02", map: nameless },
      { slot: "MAP03", map: { ...testMap, name: "Quiet" }, par: null },
    ]);
    expect(umapinfo(wad)).toBe(
      [
        "MAP MAP01\n{",
        "  levelname = \"The 'Entry'\"",
        "  partime = 95",
        '  music = "D_RUNNIN"',
        '  skytexture = "SKY2"',
        '  intertext = "You made it out.", "", "Now the real work starts."',
        "}\n",
        'MAP MAP03\n{\n  levelname = "Quiet"\n}\n',
      ].join("\n"),
    );
    const [first] = readMaps([{ name: "e.wad", data: wad }]);
    expect(first.title).toBe("The 'Entry'");
  });

  it("flags Doom II's things in a Doom 1 game", () => {
    const revenant: GameMap = {
      ...testMap,
      things: [
        ...testMap.things,
        { id: "revenant-1", kind: "revenant", x: 704, y: 200, angle: 0 },
      ],
    };
    expect(validateMap(revenant)).toEqual([]);
    expect(validateMap(revenant, { game: games.doom2 })).toEqual([]);
    expect(
      validateMap(revenant, { game: doom }).map((issue) => issue.id),
    ).toEqual(["thing-game:revenant-1"]);
    expect(validateMap(revenant, { game: doom })[0].message).toMatch(
      /Revenant isn't in The Ultimate Doom/,
    );
  });

  it("flags textures the game doesn't have", () => {
    expect(validateMap(testMap, { names })).toEqual([]);
    const painted: GameMap = {
      ...testMap,
      sectors: testMap.sectors.map((sector) =>
        sector.id === "sector-3"
          ? { ...sector, wallTexture: "AQF001" }
          : sector,
      ),
      lines: {
        [wallKey("v3", "v4")]: { sides: { "sector-2": { lower: "ZIMMER8" } } },
      },
    };
    expect(
      validateMap(painted, { names, game: doom }).map((issue) => issue.id),
    ).toEqual([
      "texture-missing:sector-3",
      `texture-missing:${wallKey("v3", "v4")}`,
    ]);
    expect(validateMap(painted, { names, game: doom })[0].message).toBe(
      "Arena: The Ultimate Doom has no texture called AQF001.",
    );
    const groups = defined(
      buildChecks(painted, { names }).find(
        (group) => group.name === "Compatibility",
      ),
    );
    expect(groups.issues).toHaveLength(2);
  });
});

function lump(map: GameMap, name: string) {
  const found = compileLumps(map).find((item) => item.name === name);
  if (!found) throw new Error(`Missing ${name}.`);
  return found.data;
}
