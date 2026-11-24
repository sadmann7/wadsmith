import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";
import { compileMap } from "@/lib/wad/compile";

import type { GameMap, Point, Sector } from "./types";

import {
  addDetail,
  addRoom,
  addSwitch,
  makePillar,
  splitWall,
  updateLine,
  updateLineSide,
} from "./edit";
import {
  containerOf,
  cross,
  loopEdges,
  loopPolygon,
  pointInPolygon,
  sectorAt,
  sectorPolygon,
  wallKey,
  wallOwners,
} from "./geometry";
import { joinWalls } from "./join";
import {
  drawLines,
  drawRoom,
  joinCornersToWalls,
  joinRooms,
  removeCorner,
} from "./reshape";
import { shapeCorners } from "./shapes";
import { starterMap } from "./starter-map";
import { pillarMap, testMap } from "./test-map";
import { validateMap } from "./validate";
import { splitIntoSteps } from "./wall-tools";

const empty: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

const hall = addRoom(
  empty,
  box(0, 0, 512, 256),
  { floor: 16, light: 200, floorTexture: "FLAT1", wallTexture: "BROWN1" },
  1,
);

describe("drawing a line across a room", () => {
  it("splits the room in two, both like the old one", () => {
    const split = defined(
      drawLines(hall.map, [
        { x: 192, y: -32 },
        { x: 192, y: 288 },
      ]),
    );
    expect(split.map.sectors).toHaveLength(2);
    const [left, right] = [
      defined(sectorAt(split.map, { x: 64, y: 64 })),
      defined(sectorAt(split.map, { x: 400, y: 64 })),
    ];
    expect(left).not.toBe(right);
    // The bigger half keeps the room's id.
    expect(right.id).toBe(hall.id);
    for (const room of [left, right]) {
      expect(room).toMatchObject({
        floor: 16,
        light: 200,
        floorTexture: "FLAT1",
        wallTexture: "BROWN1",
      });
    }
    expect(sharedWalls(split.map)).toHaveLength(1);
    expect(problems(split.map)).toEqual([]);
    expect(split.rooms.toSorted()).toEqual([left.id, right.id].toSorted());
    expect(() => compileMap(split.map)).not.toThrow();
  });

  it("splits along a bent line from wall to wall", () => {
    const split = defined(
      drawLines(hall.map, [
        { x: 128, y: 0 },
        { x: 256, y: 128 },
        { x: 384, y: 0 },
      ]),
    );
    expect(split.map.sectors).toHaveLength(2);
    expect(problems(split.map)).toEqual([]);
  });

  it("splits every room the line crosses", () => {
    const pair = addRoom(hall.map, box(512, 0, 768, 256), {}, 1);
    const split = defined(
      drawLines(pair.map, [
        { x: -64, y: 128 },
        { x: 832, y: 128 },
      ]),
    );
    expect(split.map.sectors).toHaveLength(4);
    expect(problems(split.map)).toEqual([]);
  });

  it("keeps a line that stays inside the room as a line in it", () => {
    const inside = defined(
      drawLines(hall.map, [
        { x: 64, y: 64 },
        { x: 128, y: 64 },
      ]),
    );
    expect(inside.map.sectors).toHaveLength(1);
    expect(inside.map.sectors[0].details).toHaveLength(1);
  });

  it("does nothing outside every room", () => {
    expect(
      drawLines(hall.map, [
        { x: 1024, y: 0 },
        { x: 1024, y: 256 },
      ]),
    ).toBeNull();
  });

  it("moves a switch and a wall's side with the half they're in", () => {
    const switched = defined(
      addSwitch(
        hall.map,
        { sector: hall.id, from: "v4", to: "v1" },
        { x: 0, y: 128 },
        null,
        1,
      ),
    ).map;
    const painted = updateLineSide(switched, wallKey("v1", "v2"), hall.id, {
      offsetX: 24,
    });
    const split = defined(
      drawLines(painted, [
        { x: 384, y: 0 },
        { x: 384, y: 256 },
      ]),
    );
    const left = defined(sectorAt(split.map, { x: 64, y: 128 }));
    const right = defined(sectorAt(split.map, { x: 448, y: 128 }));
    expect(left.id).toBe(hall.id);
    expect(split.map.switches[0].sector).toBe(left.id);
    const sides = Object.values(split.map.lines ?? {}).flatMap((line) =>
      Object.entries(line.sides ?? {}),
    );
    expect(sides.map(([id]) => id).toSorted()).toEqual(
      [left.id, right.id].toSorted(),
    );
    expect(problems(split.map)).toEqual([]);
  });

  it("splits a room on both sides of a room drawn inside it", () => {
    const island = drawRoom(hall.map, box(192, 64, 320, 192), { floor: 32 }, 1);
    const split = defined(
      drawLines(island.map, [
        { x: 256, y: -32 },
        { x: 256, y: 288 },
      ]),
    );
    expect(sectorAt(split.map, { x: 64, y: 128 })).not.toBe(
      sectorAt(split.map, { x: 448, y: 128 }),
    );
    expect(split.map.sectors).toHaveLength(4);
    expect(problems(split.map)).toEqual([]);
  });

  it("refuses in split mode a line that leaves the room whole", () => {
    const island = drawRoom(hall.map, box(192, 64, 320, 192), {}, 1);
    const spoke = [
      { x: 0, y: 128 },
      { x: 192, y: 128 },
    ];
    expect(drawLines(island.map, spoke, 1, "split")).toBeNull();
    const drawn = defined(drawLines(island.map, spoke, 1));
    expect(drawn.map.sectors[0].details).toHaveLength(1);
    expect(
      drawLines(
        hall.map,
        [
          { x: 64, y: 64 },
          { x: 128, y: 64 },
        ],
        1,
        "split",
      ),
    ).toBeNull();
  });

  it("closes a piece off with a line drawn earlier from wall to wall", () => {
    const island = drawRoom(hall.map, box(192, 64, 320, 192), {}, 1);
    const first = defined(
      drawLines(
        island.map,
        [
          { x: 0, y: 112 },
          { x: 192, y: 112 },
        ],
        1,
      ),
    );
    const spoke = [
      { x: 0, y: 144 },
      { x: 192, y: 144 },
    ];
    for (const mode of ["draw", "split"] as const) {
      const second = defined(drawLines(first.map, spoke, 1, mode));
      expect(second.map.sectors).toHaveLength(3);
      expect(second.map.sectors.every((sector) => !sector.details)).toBe(true);
      const strip = defined(sectorAt(second.map, { x: 96, y: 128 }));
      expect(strip).not.toBe(sectorAt(second.map, { x: 96, y: 32 }));
      expect(problems(second.map)).toEqual([]);
    }
  });

  it("keeps a line from wall to wall when another line splits the room", () => {
    const corridor = addRoom(empty, box(0, 0, 256, 512), {}, 1);
    let map = corridor.map;
    for (const [from, to, x] of [
      ["v2", "v3", 256],
      ["v4", "v1", 0],
    ] as const) {
      map = defined(splitWall(map, wallKey(from, to), { x, y: 128 }, 1)).map;
    }
    const trigger = defined(
      addDetail(
        map,
        [
          { x: 0, y: 128 },
          { x: 256, y: 128 },
        ],
        1,
      ),
    ).map;
    const split = defined(
      drawLines(trigger, [
        { x: 0, y: 384 },
        { x: 256, y: 384 },
      ]),
    );
    expect(split.map.sectors).toHaveLength(2);
    expect(split.map.sectors.flatMap((sector) => sector.details ?? [])).toEqual(
      [expect.any(Array)],
    );
    expect(splitIntoSteps(trigger, corridor.id, 2, 8, false)).not.toBeNull();
  });

  it("splits a room around a pillar, which goes to the half it's in", () => {
    const pillar = addRoom(hall.map, box(64, 64, 128, 128), {}, 1);
    const holed = {
      ...pillar.map,
      sectors: [
        {
          ...pillar.map.sectors[0],
          holes: [pillar.map.sectors[1].vertices],
        },
      ],
    };
    const split = defined(
      drawLines(holed, [
        { x: 256, y: 0 },
        { x: 256, y: 256 },
      ]),
    );
    const left = defined(sectorAt(split.map, { x: 32, y: 32 }));
    expect(left.holes).toHaveLength(1);
    expect(sectorAt(split.map, { x: 96, y: 96 })).toBeUndefined();
    expect(problems(split.map)).toEqual([]);
  });
});

describe("drawing a room over another", () => {
  it("cuts both up instead of leaving them overlapping", () => {
    const drawn = drawRoom(hall.map, box(384, 64, 640, 192), {}, 1);
    expect(problems(drawn.map)).toEqual([]);
    const inside = defined(sectorAt(drawn.map, { x: 448, y: 128 }));
    const outside = defined(sectorAt(drawn.map, { x: 600, y: 128 }));
    const rest = defined(sectorAt(drawn.map, { x: 64, y: 64 }));
    expect(rest.id).toBe(hall.id);
    expect(inside.id).not.toBe(hall.id);
    expect(inside.floor).toBe(16);
    expect(outside.floor).toBe(0);
    expect(drawn.map.sectors).toHaveLength(3);
    expect(() => compileMap(drawn.map)).not.toThrow();
  });

  it("still nests a room drawn wholly inside another", () => {
    const drawn = drawRoom(hall.map, box(64, 64, 128, 128), {}, 1);
    expect(drawn.map.sectors).toHaveLength(2);
    expect(sectorAt(drawn.map, { x: 96, y: 96 })?.id).toBe(drawn.id);
  });
});

describe("drawing a room against the wall of the room it's in", () => {
  const lava = drawRoom(
    empty,
    [
      { x: 216, y: 16 },
      { x: 464, y: 16 },
      { x: 624, y: 176 },
      { x: 624, y: 416 },
      { x: 464, y: 576 },
      { x: 216, y: 576 },
      { x: 56, y: 416 },
      { x: 56, y: 176 },
    ],
    { name: "Lava Hall", floor: -16 },
    1,
  );
  const island = drawRoom(lava.map, box(296, 248, 392, 344), { floor: 32 }, 1);

  it("cuts the outer room round a bridge from its wall to an island", () => {
    const bridge = drawRoom(island.map, box(56, 280, 296, 312), {}, 1);
    expect(problems(bridge.map)).toEqual([]);
    expect(sectorAt(bridge.map, { x: 160, y: 296 })?.id).toBe(bridge.id);
    expect(sectorAt(bridge.map, { x: 344, y: 296 })?.id).toBe(island.id);
    expect(sectorAt(bridge.map, { x: 160, y: 200 })?.id).toBe(lava.id);
    expect(sectorAt(bridge.map, { x: 160, y: 400 })?.id).toBe(lava.id);
    const owners = wallOwners(bridge.map);
    const ends = (x: number) =>
      defined(sectorWall(bridge.map, { x, y: 280 }, { x, y: 312 }));
    expect(owners.get(ends(56))?.map((room) => room.id)).toEqual([bridge.id]);
    expect(
      owners
        .get(ends(296))
        ?.map((room) => room.id)
        .toSorted(),
    ).toEqual([bridge.id, island.id].toSorted());
    expect(() => compileMap(bridge.map)).not.toThrow();
  });

  it("cuts it round a bridge that stops short of the island", () => {
    const bridge = drawRoom(island.map, box(56, 280, 288, 312), {}, 1);
    expect(problems(bridge.map)).toEqual([]);
    expect(sectorAt(bridge.map, { x: 292, y: 296 })?.id).toBe(lava.id);
    expect(sectorAt(bridge.map, { x: 344, y: 296 })?.id).toBe(island.id);
  });

  it("splits it in two with bridges from both walls", () => {
    const west = drawRoom(island.map, box(56, 280, 296, 312), {}, 1);
    const east = drawRoom(west.map, box(392, 280, 624, 312), {}, 1);
    expect(problems(east.map)).toEqual([]);
    const north = defined(sectorAt(east.map, { x: 340, y: 100 }));
    const south = defined(sectorAt(east.map, { x: 340, y: 500 }));
    expect(north.id).not.toBe(south.id);
    expect([north.id, south.id]).toContain(lava.id);
    expect(south.floor).toBe(-16);
    expect(north.floor).toBe(-16);
    expect(east.map.sectors).toHaveLength(5);
    expect(() => compileMap(east.map)).not.toThrow();
  });

  it("splits it in two with one bridge from wall to wall over the island", () => {
    const bridge = drawRoom(
      island.map,
      box(56, 280, 624, 312),
      { floor: 0 },
      1,
    );
    expect(problems(bridge.map)).toEqual([]);
    expect(sectorAt(bridge.map, { x: 340, y: 100 })).not.toBe(
      sectorAt(bridge.map, { x: 340, y: 500 }),
    );
    expect(sectorAt(bridge.map, { x: 344, y: 296 })?.floor).toBe(32);
    expect(sectorAt(bridge.map, { x: 160, y: 296 })?.id).toBe(bridge.id);
    expect(sectorAt(bridge.map, { x: 500, y: 296 })?.floor).toBe(0);
    expect(() => compileMap(bridge.map)).not.toThrow();
  });
});

describe("drawing a room against the wall of the room it's in, around obstacles", () => {
  it("leaves a pillar it covers in place and the map flagged", () => {
    const post = drawRoom(hall.map, box(200, 96, 232, 128), {}, 1);
    const pillared = defined(makePillar(post.map, post.id));
    const bridge = drawRoom(pillared, box(0, 80, 512, 144), {}, 1);
    expect(
      bridge.map.sectors.find((room) => room.id === hall.id)?.holes,
    ).toHaveLength(1);
    const sameSide = validateMap(bridge.map).find((issue) =>
      issue.id.startsWith("same-side:"),
    );
    expect(sameSide?.target).toBe(bridge.id);
    expect(sameSide?.message).toContain("without lying over its pillars");
    expect(sameSide?.message).toContain(
      `Move ${defined(bridge.map.sectors.find((room) => room.id === bridge.id)).name} off`,
    );
  });

  it("cuts no room when it covers a pillar of the room it's in", () => {
    for (const corners of [
      box(176, 160, 528, 424),
      box(160, 192, 640, 352),
      box(160, 160, 640, 512),
    ]) {
      const drawn = drawRoom(pillarMap, corners, {}, 1);
      const plain = addRoom(pillarMap, corners, {}, 1);
      expect(drawn.map).toEqual(joinWalls(plain.map, [plain.id]));
      expect(drawn.map.sectors).toHaveLength(pillarMap.sectors.length + 1);
    }
  });

  it("still cuts round a room with a pillar that it's drawn round", () => {
    const around = drawRoom(pillarMap, box(-200, -200, 1100, 700), {}, 1).map;
    for (const [base, corners] of [
      [pillarMap, box(-64, -64, 832, 576)],
      [pillarMap, box(0, 0, 1024, 576)],
      [pillarMap, box(0, 0, 832, 512)],
      [around, box(-100, -100, 1500, 650)],
    ] as const) {
      const drawn = drawRoom(base, corners, {}, 1);
      expect(problems(drawn.map)).toEqual([]);
      expect(
        drawn.map.sectors.find((room) => room.id === "hall")?.holes,
      ).toHaveLength(1);
      expect(() => compileMap(drawn.map)).not.toThrow();
    }
  });

  it("cuts no room when it crosses a room with a pillar it covers", () => {
    const corners = [
      { x: -64, y: -64 },
      { x: 832, y: -64 },
      { x: 832, y: 400 },
      { x: 640, y: 576 },
      { x: -64, y: 576 },
    ];
    const drawn = drawRoom(pillarMap, corners, {}, 1);
    const plain = addRoom(pillarMap, corners, {}, 1);
    expect(drawn.map).toEqual(joinWalls(plain.map, [plain.id]));
  });

  it("cuts the outer room round a bridge that only reaches a pillar", () => {
    const post = drawRoom(hall.map, box(200, 96, 232, 128), {}, 1);
    const pillared = defined(makePillar(post.map, post.id));
    for (const corners of [
      box(0, 96, 200, 128),
      box(232, 96, 512, 128),
      box(200, 0, 232, 96),
      box(200, 128, 232, 256),
    ]) {
      const bridge = drawRoom(pillared, corners, {}, 1);
      expect(problems(bridge.map)).toEqual([]);
      expect(() => compileMap(bridge.map)).not.toThrow();
    }
  });

  it("cuts a room drawn round an earlier one against its wall", () => {
    const inner = drawRoom(empty, box(0, 64, 128, 128), {}, 1);
    const outer = drawRoom(inner.map, box(0, 0, 512, 256), { floor: 16 }, 1);
    expect(problems(outer.map)).toEqual([]);
    expect(sectorAt(outer.map, { x: 64, y: 96 })?.id).toBe(inner.id);
    expect(sectorAt(outer.map, { x: 256, y: 128 })?.floor).toBe(16);
    expect(() => compileMap(outer.map)).not.toThrow();
  });
});

describe("joining rooms", () => {
  it("makes one room of two that share a wall", () => {
    const next = addRoom(
      hall.map,
      box(512, 0, 768, 256),
      { wallTexture: "METAL" },
      1,
    );
    const joined = defined(joinRooms(next.map, [hall.id, next.id]));
    expect(joined.id).toBe(hall.id);
    expect(joined.map.sectors).toHaveLength(1);
    const room = joined.map.sectors[0];
    expect(room.floor).toBe(16);
    expect(Object.values(room.wallOverrides ?? {})).toEqual([
      "METAL",
      "METAL",
      "METAL",
    ]);
    expect(problems(joined.map)).toEqual([]);
  });

  it("leaves a gap the rooms closed round as a pillar", () => {
    let map = empty;
    for (const corners of [
      box(0, 0, 192, 64),
      box(0, 64, 64, 128),
      box(128, 64, 192, 128),
      box(0, 128, 192, 192),
    ]) {
      map = drawRoom(map, corners, {}, 1).map;
    }
    const joined = defined(
      joinRooms(
        map,
        map.sectors.map((sector) => sector.id),
      ),
    );
    expect(joined.map.sectors).toHaveLength(1);
    expect(joined.map.sectors[0].holes).toHaveLength(1);
    expect(sectorAt(joined.map, { x: 96, y: 96 })).toBeUndefined();
    expect(problems(joined.map)).toEqual([]);
  });

  it("refuses a room and a platform drawn inside it", () => {
    const platform = drawRoom(hall.map, box(64, 64, 128, 128), {}, 1);
    expect(joinRooms(platform.map, [hall.id, platform.id])).toBeNull();
  });

  it("refuses rooms that don't touch", () => {
    const far = addRoom(hall.map, box(1024, 0, 1280, 256), {}, 1);
    expect(joinRooms(far.map, [hall.id, far.id])).toBeNull();
  });
});

describe("removing a corner", () => {
  it("joins the two walls that met there", () => {
    const bent = addRoom(
      empty,
      [
        { x: 0, y: 0 },
        { x: 128, y: 0 },
        { x: 256, y: 0 },
        { x: 256, y: 128 },
        { x: 0, y: 128 },
      ],
      {},
      1,
    );
    const removed = defined(removeCorner(bent.map, "v2"));
    expect(removed.sectors[0].vertices).toEqual(["v1", "v3", "v4", "v5"]);
    expect(removed.vertices.v2).toBeUndefined();
  });

  it("gives back the wall it was split from", () => {
    for (const corners of [
      box(0, 0, 512, 256),
      box(0, 0, 512, 256).toReversed(),
    ]) {
      const room = addRoom(empty, corners, {}, 1);
      const top = wallKey("v1", "v2");
      const painted = updateLine(
        updateLineSide(room.map, top, room.id, { offsetX: 5 }),
        top,
        { mapped: true },
      );
      const split = defined(splitWall(painted, top, { x: 200, y: 0 }, 1));
      const back = defined(removeCorner(split.map, split.id));
      expect(back.lines).toEqual(painted.lines);
    }
  });

  it("keeps a corner whose walls both carry an action", () => {
    const room = addRoom(empty, box(0, 0, 512, 256), {}, 1);
    const split = defined(
      splitWall(room.map, wallKey("v1", "v2"), { x: 200, y: 0 }, 1),
    );
    const exit = {
      kind: "exit",
      trigger: "switch",
      repeat: false,
      tag: 0,
    } as const;
    const both = updateLine(
      updateLine(split.map, wallKey("v1", split.id), { action: exit }),
      wallKey(split.id, "v2"),
      { action: exit },
    );
    expect(removeCorner(both, split.id)).toBeNull();
  });

  it("keeps a corner whose triangle holds a pillar", () => {
    const pillar = addRoom(hall.map, box(400, 20, 480, 60), {}, 1);
    const holed = defined(makePillar(pillar.map, pillar.id));
    expect(removeCorner(holed, "v2")).toBeNull();
  });

  it("keeps a corner whose joined wall would cross another", () => {
    const ell = addRoom(
      empty,
      [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 256, y: 128 },
        { x: 128, y: 128 },
        { x: 128, y: 256 },
        { x: 0, y: 256 },
      ],
      {},
      1,
    );
    const notch = addRoom(ell.map, box(160, 160, 240, 240), {}, 1);
    expect(removeCorner(notch.map, "v4")).toBeNull();
  });

  it("keeps a corner where three walls meet, or a triangle's", () => {
    const pair = addRoom(hall.map, box(512, 0, 768, 256), {}, 1);
    const shared = defined(
      pair.map.sectors[1].vertices.find((id) =>
        pair.map.sectors[0].vertices.includes(id),
      ),
    );
    expect(removeCorner(pair.map, shared)).toBeNull();
    const triangle = addRoom(
      empty,
      [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
        { x: 0, y: 64 },
      ],
      {},
      1,
    );
    expect(removeCorner(triangle.map, "v1")).toBeNull();
  });
});

describe("dropping a corner on a wall", () => {
  it("joins a wall laid along another", () => {
    const side = addRoom(hall.map, box(128, 320, 384, 448), {}, 1);
    const [first, second] = side.map.sectors[1].vertices;
    const moved = {
      ...side.map,
      vertices: {
        ...side.map.vertices,
        [first]: { x: -64, y: 256 },
        [second]: { x: 576, y: 256 },
      },
    };
    const joined = joinCornersToWalls(moved, [first, second]);
    expect(sharedWalls(joined)).toHaveLength(1);
  });

  it("makes it a corner of that wall", () => {
    const below = addRoom(hall.map, box(128, 300, 256, 384), {}, 1);
    const corner = below.map.sectors[1].vertices[0];
    const moved = {
      ...below.map,
      vertices: { ...below.map.vertices, [corner]: { x: 128, y: 256 } },
    };
    const joined = joinCornersToWalls(moved, [corner]);
    expect(joined.sectors[0].vertices).toContain(corner);
  });
});

describe("drawing over the starter maps", () => {
  it("never adds a problem the map didn't have", () => {
    let seed = 7;
    const random = (range: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * range);
    };
    const onGrid = (value: number) => Math.round(value / 8) * 8;
    const added: string[] = [];
    for (const base of [testMap, starterMap, pillarMap]) {
      const before = new Set(problems(base));
      const fresh = (label: string, map: GameMap, allowed: string[] = []) => {
        const found = problems(map).filter(
          (id) => !before.has(id) && !allowed.includes(id),
        );
        if (found.length > 0) added.push(`${label}: ${found.join(", ")}`);
        else compileMap(map);
      };
      const points = Object.values(base.vertices);
      // Every third room spans corners already on the map, so its sides meet
      // walls, pillars and lines exactly.
      const span = (values: number[]) => {
        const first = values[random(values.length)];
        const rest = values.filter((value) => value !== first);
        const second = rest[random(rest.length)];
        return [Math.min(first, second), Math.max(first, second)];
      };
      const pillars = base.sectors.flatMap((sector) =>
        (sector.holes ?? []).map((hole) => ({
          hole,
          room: sectorPolygon(base, sector),
          shape: loopPolygon(base, hole),
        })),
      );
      // A pillar turning into floor breaks no check, so each edit must leave
      // empty every part of a pillar it doesn't cover.
      const keepsPillars = (
        label: string,
        map: GameMap,
        covered: Point[] = [],
        moved = "",
      ) => {
        const filled = pillars.filter(
          ({ hole, shape }) =>
            !hole.includes(moved) &&
            insidePoints(shape).some(
              (point) => !getIsCovered(point, covered) && sectorAt(map, point),
            ),
        );
        if (filled.length > 0) {
          added.push(
            `${label}: pillar ${filled.map(({ hole }) => hole.join(" ")).join(", ")} filled`,
          );
        }
      };
      const wallsOf = (sector: Sector) =>
        loopEdges(sector.vertices).map(({ from, to }) => [
          base.vertices[from],
          base.vertices[to],
        ]);
      const heldWalls = [
        ...base.switches.map((item) => [
          base.vertices[item.from],
          base.vertices[item.to],
        ]),
        ...base.sectors.filter((sector) => sector.door).flatMap(wallsOf),
        // TODO: https://linear.app/gamepad/issue/BASE-378/cut-the-outer-room-round-a-room-drawn-against-its-wall-that-touches-a
        ...base.sectors
          .filter((sector) => containerOf(base, sector))
          .flatMap(wallsOf),
      ];
      const xs = [...new Set(points.map((point) => point.x))];
      const ys = [...new Set(points.map((point) => point.y))];
      for (let round = 0; round < 300; round += 1) {
        let x = onGrid(random(1200) - 100);
        let y = onGrid(random(700) - 150);
        let right = onGrid(x + 16 + random(400));
        let bottom = onGrid(y + 16 + random(300));
        if (round % 3 === 1) {
          [x, right] = span(xs);
          [y, bottom] = span(ys);
        }
        const corners =
          round % 3 === 0
            ? defined(
                shapeCorners(
                  "polygon",
                  3 + (round % 7),
                  { x, y },
                  { x: right, y },
                  8,
                ),
              )
            : box(x, y, right, bottom);
        const label = JSON.stringify(corners);
        // Over a pillar of a room it's not drawn round, or touching a door, a
        // switch's wall or a room inside another, a room is drawn as before,
        // lying over the other and flagged by the checks.
        const drawn = drawRoom(base, corners, {}, 1).map;
        keepsPillars(`room ${label}`, drawn, corners);
        const plain = addRoom(base, corners, {}, 1);
        const isHeld =
          pillars.some(
            ({ room, shape }) =>
              getIsOverlapping(corners, shape) &&
              !room.every((point) => getIsCovered(point, corners)),
          ) || heldWalls.some((wall) => getIsTouching(corners, wall));
        if (
          !isHeld ||
          JSON.stringify(drawn) !==
            JSON.stringify(joinWalls(plain.map, [plain.id]))
        ) {
          fresh(`room ${label}`, drawn);
        }
        const line = drawLines(
          base,
          round % 2 ? [corners[0], corners[2]] : corners.slice(0, 3),
          1,
        );
        if (line) {
          fresh(`line ${label}`, line.map);
          keepsPillars(`line ${label}`, line.map);
        }
      }
      for (const first of base.sectors) {
        for (const second of base.sectors) {
          const joined =
            first !== second && joinRooms(base, [first.id, second.id]);
          if (joined) {
            fresh(`join ${first.id} ${second.id}`, joined.map);
            keepsPillars(`join ${first.id} ${second.id}`, joined.map);
          }
        }
      }
      for (const id of Object.keys(base.vertices)) {
        const removed = removeCorner(base, id);
        // A thing can end up outside the room once a corner goes.
        if (removed) {
          fresh(`corner ${id}`, removed, ["outside"]);
          keepsPillars(`corner ${id}`, removed, [], id);
        }
      }
    }
    expect(added).toEqual([]);
  }, 30_000);
});

function insidePoints(polygon: Point[]) {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const points: Point[] = [];
  for (let x = Math.min(...xs) + 2; x < Math.max(...xs); x += 4) {
    for (let y = Math.min(...ys) + 2; y < Math.max(...ys); y += 4) {
      if (pointInPolygon({ x, y }, polygon)) points.push({ x, y });
    }
  }
  return points;
}

function getIsOverlapping(first: Point[], second: Point[]) {
  const xs = second.map((point) => point.x);
  const ys = second.map((point) => point.y);
  for (let x = Math.min(...xs) + 2; x < Math.max(...xs); x += 4) {
    for (let y = Math.min(...ys) + 2; y < Math.max(...ys); y += 4) {
      const point = { x, y };
      if (pointInPolygon(point, first) && pointInPolygon(point, second)) {
        return true;
      }
    }
  }
  return false;
}

function getIsTouching(polygon: Point[], [from, to]: Point[]) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y));
  return Array.from({ length: steps + 1 }, (_, step) => ({
    x: from.x + ((to.x - from.x) * step) / steps,
    y: from.y + ((to.y - from.y) * step) / steps,
  })).some((point) => getIsCovered(point, polygon));
}

function getIsCovered(point: Point, polygon: Point[]) {
  return (
    pointInPolygon(point, polygon) ||
    polygon.some((corner, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return (
        cross(corner, next, point) === 0 &&
        point.x >= Math.min(corner.x, next.x) &&
        point.x <= Math.max(corner.x, next.x) &&
        point.y >= Math.min(corner.y, next.y) &&
        point.y <= Math.max(corner.y, next.y)
      );
    })
  );
}

function sharedWalls(map: GameMap) {
  return [...wallOwners(map)]
    .filter(([, owners]) => owners.length === 2 && owners[0] !== owners[1])
    .map(([key]) => key);
}

function sectorWall(map: GameMap, a: Point, b: Point) {
  const [from, to] = [a, b].map((point) =>
    Object.keys(map.vertices).find(
      (id) => map.vertices[id].x === point.x && map.vertices[id].y === point.y,
    ),
  );
  return from && to ? wallKey(from, to) : undefined;
}

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ] satisfies Point[];
}

function problems(map: GameMap) {
  return validateMap(map)
    .map((issue) => issue.id.split(":")[0])
    .filter((id) => !["no-player", "no-exit", "switch-unwired"].includes(id));
}
