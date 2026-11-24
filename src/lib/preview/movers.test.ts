import { describe, expect, it } from "vitest";

import type {
  GameMap,
  LineActionKind,
  LineSettings,
  Sector,
} from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { generalizedClass, withField } from "@/lib/map/boom";
import { setLineTarget, updateLine, updateSector } from "@/lib/map/edit";
import { wallKey } from "@/lib/map/geometry";
import { testMap } from "@/lib/map/test-map";

import {
  getIsMover,
  movedRooms,
  moverAt,
  type TextureHeight,
  withMovers,
} from "./movers";

const doorWall = wallKey("v13", "v14");
const openWall = wallKey("v3", "v4");

describe("doors and lifts in the 3D view", () => {
  it("shuts every door, and opens one to just under the lowest ceiling beside it", () => {
    const door = (opened: string[]) =>
      defined(
        withMovers(testMap, opened).sectors.find(
          (sector) => sector.id === "sector-4",
        ),
      );
    expect(door([]).ceiling).toBe(door([]).floor);
    // The corridor's ceiling is at 96 and the arena's at 192.
    expect(door(["sector-4"]).ceiling).toBe(92);
    expect(withMovers(testMap, [])).toBe(withMovers(testMap, []));
  });

  it("lowers a lift to the lowest floor beside it", () => {
    const raised = updateSector(testMap, "sector-2", { floor: 64 });
    const wired = setLineTarget(
      updateLine(raised, openWall, {
        action: { kind: "lift", trigger: "switch", repeat: true, tag: 0 },
      }),
      openWall,
      "sector-2",
    );
    const corridor = (opened: string[]) =>
      defined(
        withMovers(wired, opened).sectors.find(
          (sector) => sector.id === "sector-2",
        ),
      ).floor;
    expect(corridor([])).toBe(64);
    // The start room's floor is at 0 and the door's at -16.
    expect(corridor(["sector-2"])).toBe(-16);
    expect(moverAt(wired, "floor:sector-2")).toBe("sector-2");
    expect(moverAt(wired, "floor:sector-1")).toBeNull();
    expect(moverAt(wired, `wall:sector-1:${openWall}:lower`)).toBe("sector-2");
  });

  it("leaves a room that is no door or lift where it is", () => {
    expect(withMovers(testMap, ["sector-1", "gone"]).sectors[0].floor).toBe(
      testMap.sectors[0].floor,
    );
    // The corridor is a lift here, and its wall into the door still stands
    // for the door.
    const wired = setLineTarget(
      updateLine(testMap, openWall, {
        action: { kind: "lift", trigger: "switch", repeat: true, tag: 0 },
      }),
      openWall,
      "sector-2",
    );
    expect(moverAt(wired, `wall:sector-2:${doorWall}:upper`)).toBe("sector-4");
  });

  it("finds the door behind a wall that wears its face", () => {
    expect(moverAt(testMap, `wall:sector-2:${doorWall}:upper`)).toBe(
      "sector-4",
    );
    expect(moverAt(testMap, "floor:sector-4")).toBe("sector-4");
    expect(moverAt(testMap, "thing:imp-1")).toBeNull();
    expect(moverAt(testMap, null)).toBeNull();
  });

  it("moves a floor or ceiling where its action leaves it", () => {
    // The corridor runs from -16 to 96, between floors at 0 and -16 and
    // ceilings at 128 and 96, with its door made a plain room.
    const doorless = updateSector(testMap, "sector-4", { door: undefined });
    const worked = (
      kind: LineActionKind,
      complevel: GameMap["complevel"] = "vanilla",
    ) =>
      defined(
        withMovers(
          setLineTarget(
            updateLine({ ...doorless, complevel }, openWall, {
              action: { kind, trigger: "switch", repeat: true, tag: 0 },
            }),
            openWall,
            "sector-2",
          ),
          ["sector-2"],
        ).sectors.find((sector) => sector.id === "sector-2"),
      );
    expect(worked("floor-raise").floor).toBe(96);
    expect(worked("floor-crush").floor).toBe(88);
    expect(worked("floor-raise-next").floor).toBe(0);
    // Vanilla raises a floor through its ceiling, and Boom stops it there.
    expect(worked("floor-raise-512").floor).toBe(496);
    expect(worked("floor-raise-512", "boom").floor).toBe(96);
    expect(worked("floor-lower-highest").floor).toBe(0);
    expect(worked("floor-lower-fast").floor).toBe(8);
    expect(worked("ceiling-lower").ceiling).toBe(-16);
    expect(worked("ceiling-lower-8").ceiling).toBe(-8);
    expect(worked("ceiling-raise").ceiling).toBe(128);
    expect(worked("light-max").floor).toBe(-16);
  });

  it("reads the ceiling of a door beside a mover as shut", () => {
    const wired = setLineTarget(
      updateLine(testMap, openWall, {
        action: {
          kind: "floor-raise",
          trigger: "switch",
          repeat: true,
          tag: 0,
        },
      }),
      openWall,
      "sector-3",
    );
    const arena = defined(
      withMovers(wired, ["sector-3"]).sectors.find(
        (sector) => sector.id === "sector-3",
      ),
    );
    // The arena's only way out is the door, shut at -16.
    expect(arena.floor).toBe(-16);
  });
});

const westWall = wallKey("t0", "b0");
const between = (at: number) => wallKey(`t${at}`, `b${at}`);

describe("stairs, donuts, platforms and crushers in the 3D view", () => {
  it("builds stairs through the rooms each step is in front of, while the floor matches", () => {
    const steps = row(
      [
        {},
        { tag: 1, floorTexture: "STEP1" },
        { floorTexture: "STEP1" },
        { floorTexture: "STEP1" },
        { floorTexture: "FLAT1" },
      ],
      acting("stairs"),
    );
    expect(heights(steps, ["r1"]).map(([floor]) => floor)).toEqual([
      0, 8, 16, 24, 0,
    ]);
    expect(moverAt(steps, "floor:r3")).toBe("r1");
    expect(moverAt(steps, "floor:r4")).toBeNull();
    expect([...movedRooms(steps, ["r1"])]).toEqual(["r1", "r2", "r3"]);
    expect(
      heights({ ...steps, lines: acting("stairs-fast") }, ["r1"]).map(
        ([floor]) => floor,
      ),
    ).toEqual([0, 16, 32, 48, 0]);
  });

  it("builds no further than the start when the next room is behind it", () => {
    const steps = row(
      [{}, { floorTexture: "STEP1" }, { tag: 1, floorTexture: "STEP1" }],
      acting("stairs"),
    );
    expect(heights(steps, ["r2"]).map(([floor]) => floor)).toEqual([0, 0, 8]);
    // A line's chosen front room turns the stair round.
    const turned = {
      ...steps,
      lines: { ...steps.lines, [between(2)]: { front: "r2" } },
    };
    expect(heights(turned, ["r2"]).map(([floor]) => floor)).toEqual([0, 16, 8]);
  });

  it("raises a door on a stair, held under its shut ceiling on Boom, and ends there", () => {
    const steps = (complevel: GameMap["complevel"]) =>
      row(
        [
          {},
          { tag: 1, floorTexture: "STEP1" },
          {
            floorTexture: "STEP1",
            door: { opensBy: "use", closes: true, texture: "BIGDOOR2" },
          },
          { floorTexture: "STEP1" },
        ],
        acting("stairs"),
        complevel,
      );
    // A door is behind every line it shares, so no step leads on from it.
    expect(heights(steps("vanilla"), ["r1"]).map(([floor]) => floor)).toEqual([
      0, 8, 16, 0,
    ]);
    expect(heights(steps("boom"), ["r1"]).map(([floor]) => floor)).toEqual([
      0, 8, 0, 0,
    ]);
  });

  it("builds Boom stairs down by their step, past other floors when told to", () => {
    const steps = row(
      [{}, { tag: 1 }, { floorTexture: "FLAT1" }, {}],
      boom("stairs", { direction: 0, step: 3, ignore: 1 }),
      "boom",
    );
    expect(heights(steps, ["r1"]).map(([floor]) => floor)).toEqual([
      0, -24, -48, -72,
    ]);
  });

  it("lowers a donut's middle and raises its pool to the floor behind the pool", () => {
    const pool = (lines: Record<string, LineSettings>) =>
      row([{ floor: 16 }, { floor: -32 }, { floor: 64, tag: 1 }], {
        ...acting("donut"),
        ...lines,
      });
    // The pool's first line has the pool behind it, as Doom reads it.
    expect(heights(pool({}), ["r2"]).map(([floor]) => floor)).toEqual([
      16, -32, -32,
    ]);
    const facing = pool({ [between(1)]: { front: "r1" } });
    expect(heights(facing, ["r2"]).map(([floor]) => floor)).toEqual([
      16, 16, 16,
    ]);
    expect(moverAt(facing, "floor:r1")).toBe("r2");
  });

  it("lowers a platform to the lowest floor beside it and a crusher to 8 above its floor", () => {
    const rooms = [{ floor: -24 }, { tag: 1, floor: 32 }, { floor: 48 }];
    expect(heights(row(rooms, acting("platform")), ["r1"])[1]).toEqual([
      -24, 128,
    ]);
    for (const kind of ["crusher", "crusher-fast", "crusher-silent"] as const) {
      expect(heights(row(rooms, acting(kind)), ["r1"])[1]).toEqual([32, 40]);
    }
    expect(getIsMover(row(rooms, acting("crusher-stop")), "r1")).toBe(false);
    const raw = row(rooms, { [westWall]: { raw: { special: 87, tag: 1 } } });
    expect(heights(raw, ["r1"])[1]).toEqual([-24, 128]);
  });

  it("raises a floor by its shortest lower wall once texture heights are known", () => {
    const map = row(
      [{}, { tag: 1, wallTexture: "SHORT" }, {}],
      acting("floor-raise-texture"),
    );
    const textureHeight = (name: string) => (name === "SHORT" ? 64 : 128);
    expect(heights(map, ["r1"], textureHeight)[1]).toEqual([64, 128]);
    expect(heights(map, ["r1"])[1]).toEqual([0, 128]);
    expect(heights(map, ["r1"], () => null)[1]).toEqual([0, 128]);
    expect(getIsMover(map, "r1")).toBe(true);
  });
});

describe("Boom's generalized movers in the 3D view", () => {
  const rooms = [
    { floor: -16, ceiling: 96 },
    { tag: 1, floor: 0, ceiling: 128 },
    { floor: 24, ceiling: 160 },
  ];

  it("moves a floor to its target, jumping there when sent the wrong way", () => {
    const floor = (values: Record<string, number>) =>
      heights(row(rooms, boom("floor", values), "boom"), ["r1"])[1][0];
    expect(floor({ direction: 1, target: 0 })).toBe(24);
    expect(floor({ direction: 0, target: 1 })).toBe(-16);
    expect(floor({ direction: 0, target: 2 })).toBe(-16);
    expect(floor({ direction: 1, target: 2 })).toBe(24);
    expect(floor({ direction: 1, target: 3 })).toBe(96);
    expect(floor({ direction: 1, target: 4 })).toBe(128);
    expect(floor({ direction: 0, target: 6 })).toBe(-24);
    expect(floor({ direction: 1, target: 7 })).toBe(32);
    expect(floor({ direction: 1, target: 1 })).toBe(-16);
  });

  it("moves a ceiling to its target, and stops a lowering one at the floor", () => {
    const ceiling = (values: Record<string, number>) =>
      heights(row(rooms, boom("ceiling", values), "boom"), ["r1"])[1][1];
    expect(ceiling({ direction: 1, target: 0 })).toBe(160);
    expect(ceiling({ direction: 0, target: 1 })).toBe(96);
    expect(ceiling({ direction: 1, target: 2 })).toBe(160);
    expect(ceiling({ direction: 0, target: 3 })).toBe(24);
    expect(ceiling({ direction: 0, target: 4 })).toBe(0);
    expect(ceiling({ direction: 1, target: 6 })).toBe(152);
    expect(ceiling({ direction: 0, target: 7 })).toBe(96);
  });

  it("lowers a lift to its target and a crusher to 8 above its floor", () => {
    const lift = (target: number) =>
      heights(row(rooms, boom("lift", { target }), "boom"), ["r1"])[1][0];
    expect(lift(0)).toBe(-16);
    expect(lift(1)).toBe(-16);
    expect(lift(2)).toBe(0);
    expect(lift(3)).toBe(-16);
    expect(heights(row(rooms, boom("crusher", {}), "boom"), ["r1"])[1]).toEqual(
      [0, 8],
    );
  });

  it("leaves them still on a vanilla map, which the engine plays without them", () => {
    const map = row(rooms, boom("floor", { direction: 1, target: 0 }));
    expect(getIsMover(map, "r1")).toBe(false);
    expect(heights(map, ["r1"])[1]).toEqual([0, 128]);
  });

  it("works the room behind a pressed line, whatever its tag", () => {
    const pressed = row(
      [{}, { floor: 32 }],
      {
        [between(1)]: {
          raw: {
            special: withField(
              defined(generalizedClass("floor")).start,
              defined(
                generalizedClass("floor")?.fields.find(
                  (field) => field.id === "trigger",
                ),
              ),
              7,
            ),
            tag: 0,
          },
        },
      },
      "boom",
    );
    expect(heights(pressed, ["r1"])[1][0]).toBe(0);
    expect(getIsMover(pressed, "r0")).toBe(false);
  });
});

describe("several movers on one room", () => {
  it("takes the action that leaves the room the most open, the first wall on a tie", () => {
    const both = row([{ floor: -16 }, { tag: 1 }, {}], {
      ...acting("floor-raise"),
      [wallKey("t1", "t2")]: {
        action: { kind: "lift", trigger: "walk", repeat: true, tag: 1 },
      },
    });
    expect(heights(both, ["r1"])[1]).toEqual([-16, 128]);
    const lowered = boom("ceiling", { direction: 0, target: 6 })[westWall];
    const raised: LineSettings = {
      action: { kind: "floor-raise-24", trigger: "walk", repeat: true, tag: 1 },
    };
    const tied = (first: LineSettings, second: LineSettings) =>
      heights(
        row(
          [{}, { tag: 1 }, {}],
          {
            [wallKey("b1", "b2")]: first,
            [wallKey("t1", "t2")]: second,
          },
          "boom",
        ),
        ["r1"],
      )[1];
    expect(tied(raised, lowered)).toEqual([24, 128]);
    expect(tied(lowered, raised)).toEqual([0, 104]);
  });

  it("leaves a floor two opened movers reach where the first in room order puts it", () => {
    const map = row(
      [
        {},
        { tag: 1, floorTexture: "STEP1" },
        { tag: 2, floorTexture: "STEP1", floor: 32 },
      ],
      {
        ...acting("stairs"),
        [wallKey("t2", "t3")]: {
          action: { kind: "lift", trigger: "walk", repeat: true, tag: 2 },
        },
      },
    );
    expect(heights(map, ["r1", "r2"])[2]).toEqual([16, 128]);
    expect(heights(map, ["r2"])[2]).toEqual([0, 128]);
  });

  it("moves a floor and a ceiling from two opened movers, never past each other on Boom", () => {
    const map = (complevel: GameMap["complevel"]) =>
      row(
        [
          {},
          { tag: 1, floorTexture: "STEP1" },
          { tag: 2, floorTexture: "STEP1" },
        ],
        {
          ...acting("stairs"),
          [wallKey("t2", "t3")]: {
            action: { kind: "crusher", trigger: "walk", repeat: true, tag: 2 },
          },
        },
        complevel,
      );
    expect(heights(map("boom"), ["r1", "r2"])[2]).toEqual([16, 16]);
    expect(heights(map("vanilla"), ["r1", "r2"])[2]).toEqual([16, 8]);
  });
});

// Rooms side by side from west to east, each 64 wide, so each room is in
// front of the line to the next.
function row(
  rooms: Partial<Sector>[],
  lines: Record<string, LineSettings> = {},
  complevel: GameMap["complevel"] = "vanilla",
): GameMap {
  const vertices: GameMap["vertices"] = {};
  for (let at = 0; at <= rooms.length; at += 1) {
    vertices[`t${at}`] = { x: at * 64, y: 0 };
    vertices[`b${at}`] = { x: at * 64, y: 128 };
  }
  return {
    complevel,
    vertices,
    sectors: rooms.map((room, at) => ({
      id: `r${at}`,
      name: `Room ${at}`,
      vertices: [`t${at}`, `t${at + 1}`, `b${at + 1}`, `b${at}`],
      floor: 0,
      ceiling: 128,
      light: 160,
      floorTexture: "FLOOR4_8",
      ceilingTexture: "CEIL3_5",
      wallTexture: "STARTAN3",
      ...room,
    })),
    things: [],
    switches: [],
    lines,
  };
}

function acting(kind: LineActionKind, tag = 1): Record<string, LineSettings> {
  return {
    [westWall]: { action: { kind, trigger: "switch", repeat: true, tag } },
  };
}

function boom(name: string, values: Record<string, number>, tag = 1) {
  const kind = defined(generalizedClass(name));
  const special = kind.fields.reduce(
    (value, field) =>
      field.id in values ? withField(value, field, values[field.id]) : value,
    kind.start,
  );
  return { [westWall]: { raw: { special, tag } } };
}

function heights(
  map: GameMap,
  opened: string[],
  textureHeight?: TextureHeight,
) {
  return withMovers(map, opened, textureHeight).sectors.map(
    ({ floor, ceiling }) => [floor, ceiling],
  );
}
