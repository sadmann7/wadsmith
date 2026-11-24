import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import type { GameMap, LineSettings } from "./types";

import { checkMap } from "./checks";
import { buildMap, rect, type RoomSpec } from "./featured/build-map";
import { wallOwners } from "./geometry";
import { starterMap } from "./starter-map";
import { inspectMap } from "./validate";

const look = {
  light: 160,
  floorTexture: "FLOOR4_8",
  ceilingTexture: "CEIL3_5",
  wallTexture: "STARTAN3",
};

describe("reachable rooms", () => {
  it("lets the player step up 24", () => {
    expect(reachWarnings(twoRooms(24))).toEqual([]);
  });

  it("warns about a room and its items behind a step of 25", () => {
    expect(reachWarnings(twoRooms(25, 153))).toEqual([
      "Ledge: the player can't get here from the start.",
      "Ledge: the player can't reach the stimpack here.",
    ]);
  });

  it("lets the player drop down into a lower room", () => {
    expect(reachWarnings(twoRooms(-200, 128))).toEqual([]);
  });

  it("warns about a room past a gap lower than the player", () => {
    const map = buildMap({
      name: "Crawlspace",
      rooms: [
        room("Hall", 0, 0, 128),
        room("Crawlspace", 128, 0, 55),
        room("Far room", 256, 0, 128),
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(reachWarnings(map)).toEqual([
      "Far room: the player can't get here from the start.",
    ]);
  });

  it("lets the player through a gap of 56", () => {
    expect(reachWarnings(twoRooms(0, 56))).toEqual([]);
  });

  it("counts a room a lift lowers as reachable", () => {
    const map = twoRooms(64, 192, {
      tag: 1,
      settings: {
        action: { kind: "lift", trigger: "walk", repeat: true, tag: 1 },
      },
    });
    expect(reachWarnings(map)).toEqual([]);
  });

  it("counts a room past a door as reachable", () => {
    const map = buildMap({
      name: "Door",
      rooms: [
        room("Hall", 0, 0, 128),
        {
          ...room("Door", 128, 0, 0),
          points: rect(128, 0, 16, 128),
          door: {
            opensBy: "use",
            closes: true,
            texture: "DOOR3",
          },
        },
        { ...room("Far room", 144, 0, 128) },
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(inspectMap(map).errors).toEqual([]);
    expect(reachWarnings(map)).toEqual([]);
  });

  it("follows a teleporter to the room it leads to", () => {
    const map = buildMap({
      name: "Teleport",
      rooms: [room("Hall", 0, 0, 128), room("Island", 512, 0, 128, { tag: 3 })],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "teleport-destination", at: [576, 64] },
      ],
    });
    const hall = map.sectors[0];
    const linked: GameMap = {
      ...map,
      vertices: {
        ...map.vertices,
        t1: { x: 32, y: 32 },
        t2: { x: 96, y: 32 },
      },
      sectors: [{ ...hall, details: [["t1", "t2"]] }, map.sectors[1]],
      lines: {
        "t1|t2": {
          action: { kind: "teleport", trigger: "walk", repeat: true, tag: 3 },
        },
      },
    };
    expect(reachWarnings(map)).toEqual([
      "Island: the player can't get here from the start.",
    ]);
    expect(inspectMap(linked).errors).toEqual([]);
    expect(reachWarnings(linked)).toEqual([]);
  });

  it("names only the items in a room too low to stand in", () => {
    expect(reachWarnings(twoRooms(64, 104))).toEqual([
      "Ledge: the player can't reach the stimpack here.",
    ]);
  });

  it("warns about an exit the player can't reach", () => {
    const map = twoRooms(64, 192);
    const ledge = map.sectors[1];
    const exitWall = defined(
      [...wallOwners(map)].find(
        ([, owners]) => owners.length === 1 && owners[0] === ledge,
      ),
    )[0];
    const withExit = {
      ...map,
      lines: {
        ...map.lines,
        [exitWall]: {
          action: {
            kind: "exit" as const,
            trigger: "switch" as const,
            repeat: false,
            tag: 0,
          },
        },
      },
    };
    expect(reachWarnings(withExit)).toContain(
      `Wall of Ledge (${exitWall}): the player can't reach this exit.`,
    );
  });

  it("finds nothing to warn about on the starter map", () => {
    expect(reachWarnings(starterMap)).toEqual([]);
  });

  it("warns about a room drawn against the Exit with its floor 32 higher", () => {
    const exit = starterMap.sectors.find((sector) => sector.name === "Exit");
    const map: GameMap = {
      ...starterMap,
      vertices: {
        ...starterMap.vertices,
        r1: { x: 1168, y: 384 },
        r2: { x: 976, y: 384 },
      },
      sectors: [
        ...starterMap.sectors,
        {
          ...look,
          id: "sector-new",
          name: "Room 11",
          vertices: ["v24", "v23", "r1", "r2"],
          floor: (exit?.floor ?? 0) + 32,
          ceiling: 96,
        },
      ],
      things: [
        ...starterMap.things,
        { id: "stimpack-9", kind: "stimpack", x: 1072, y: 320, angle: 0 },
      ],
    };
    const checks = checkMap(map);
    expect(checks.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(
      checks
        .filter((issue) => issue.id.startsWith("unreachable"))
        .map(({ id, severity }) => ({ id, severity })),
    ).toEqual([
      { id: "unreachable:sector-new", severity: "warning" },
      { id: "unreachable-thing:stimpack-9", severity: "warning" },
    ]);
  });
});

function room(
  name: string,
  x: number,
  floor: number,
  ceiling: number,
  extra: Partial<RoomSpec> = {},
): RoomSpec {
  return {
    name,
    points: rect(x, 0, 128, 128),
    floor,
    ceiling,
    ...look,
    ...extra,
  };
}

function reachWarnings(map: GameMap) {
  return inspectMap(map)
    .warnings.filter((issue) => issue.id.startsWith("unreachable"))
    .map((issue) => issue.message);
}

function twoRooms(
  floor: number,
  ceiling = 128,
  { tag, settings }: { tag?: number; settings?: LineSettings } = {},
) {
  return buildMap({
    name: "Two rooms",
    rooms: [
      room("Hall", 0, 0, 128),
      room("Ledge", 128, floor, ceiling, { tag }),
    ],
    things: [
      { kind: "player", at: [64, 64] },
      { kind: "stimpack", at: [192, 64] },
    ],
    lines: settings
      ? [
          {
            wall: [
              [128, 0],
              [128, 128],
            ],
            settings,
          },
        ]
      : [],
  });
}
