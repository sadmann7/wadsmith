import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";
import { type CustomThings, customThingsOf } from "@/lib/wad/custom-things";
import { packWad } from "@/lib/wad/pack";

import type { GameMap, LineSettings } from "./types";

import { checkMap, fixIssue } from "./checks";
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

  it("warns about a room behind an MBF21 line that blocks players", () => {
    const map = twoRooms(0, 128, { settings: { blocksPlayers: true } });
    expect(reachWarnings({ ...map, complevel: "mbf21" })).toEqual([
      "Ledge: the player can't get here from the start.",
      "Ledge: the player can't reach the stimpack here.",
    ]);
    expect(reachWarnings({ ...map, complevel: "mbf" })).toEqual([]);
    const walkers = twoRooms(0, 128, { settings: { blocksWalkers: true } });
    expect(reachWarnings({ ...walkers, complevel: "mbf21" })).toEqual([]);
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
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "stimpack", at: [320, 64] },
      ],
    });
    expect(reachWarnings(map)).toEqual([
      "Far room: the player can't get here from the start.",
      "Far room: the player can't reach the stimpack here.",
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
        { kind: "stimpack", at: [600, 96] },
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
      "Island: the player can't reach the stimpack here.",
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
        ([wall, owners]) =>
          owners.length === 1 &&
          owners[0] === ledge &&
          wall.split("|").every((id) => map.vertices[id].x === 256),
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

  it("lets the player step over a trench narrower than itself", () => {
    const map = buildMap({
      name: "Trench",
      rooms: [
        room("Hall", 0, 0, 128),
        { ...room("Trench", 128, -64, 128), points: rect(128, 0, 16, 128) },
        room("Far room", 144, 0, 128),
      ],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "stimpack", at: [208, 64] },
      ],
    });
    expect(reachWarnings(map)).toEqual([]);
  });

  it("doesn't run across a raised block", () => {
    const map = buildMap({
      name: "Block",
      rooms: [
        room("Hall", 0, 0, 256),
        room("Block", 128, 96, 256),
        room("Cage", 256, 0, 256),
      ],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "stimpack", at: [320, 64] },
      ],
    });
    expect(reachWarnings(map)).toEqual([
      "Cage: the player can't get here from the start.",
      "Cage: the player can't reach the stimpack here.",
    ]);
  });

  it("runs across a pit to a floor within a step", () => {
    const map = buildMap({
      name: "Pit",
      rooms: [
        room("Hall", 0, 0, 256),
        room("Pit", 128, -256, 256),
        room("Far room", 256, 24, 256),
      ],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "stimpack", at: [320, 64] },
      ],
    });
    expect(reachWarnings(map)).toEqual([]);
  });

  it("lets the player pick up an item at the edge of a ledge", () => {
    const map = buildMap({
      name: "Edge",
      rooms: [room("Hall", 0, 0, 128), room("Ledge", 128, 48, 192)],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "stimpack", at: [136, 64] },
      ],
    });
    expect(reachWarnings(map)).toEqual([]);
  });

  it("lets the player press an exit switch within reach", () => {
    const map = buildMap({
      name: "Alcove",
      rooms: [
        room("Hall", 0, 0, 128),
        {
          ...room("Alcove", 128, 48, 128),
          points: rect(128, 32, 16, 64),
        },
      ],
      things: [{ kind: "player", at: [64, 64] }],
      lines: [
        {
          wall: [
            [144, 32],
            [144, 96],
          ],
          settings: {
            action: { kind: "exit", trigger: "switch", repeat: false, tag: 0 },
          },
        },
      ],
    });
    expect(reachWarnings(map)).toEqual([]);
  });

  it("leaves out an empty room out of reach, like a crate", () => {
    const map = buildMap({
      name: "Crate",
      rooms: [room("Hall", 0, 0, 128), room("Crate", 128, 64, 128)],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(reachWarnings(map)).toEqual([]);
  });

  it("finds nothing to warn about on the starter map", () => {
    expect(reachWarnings(starterMap)).toEqual([]);
  });

  it("warns about a patch's item behind a step the player can't climb", () => {
    const mod = packWad([
      {
        name: "DEHACKED",
        data: new TextEncoder().encode(
          "Thing 152 (Plasma Pack)\nID # = 20003\nBits = SPECIAL\n\nThing 153 (Tall Lamp)\nID # = 20004\nBits = SOLID\n",
        ),
      },
    ]);
    const custom = customThingsOf([mod]);
    const base = twoRooms(25);
    const map: GameMap = {
      ...base,
      things: [
        ...base.things.filter((thing) => thing.kind === "player"),
        ...[20003, 20004].map((type) => ({
          id: `custom-${type}`,
          kind: "custom" as const,
          type,
          x: 192,
          y: type === 20003 ? 64 : 96,
          angle: 0,
        })),
      ],
    };
    expect(reachWarnings(map)).toEqual([]);
    expect(reachWarnings(map, custom)).toEqual([
      "Ledge: the player can't get here from the start.",
      "Ledge: the player can't reach the plasma pack here.",
    ]);
    expect(
      checkMap(map, { custom })
        .filter((issue) => issue.id.startsWith("unreachable-thing"))
        .map((issue) => issue.target),
    ).toEqual(["custom-20003"]);
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

describe("rooms not joined to the map", () => {
  it("warns about a room touching another only at a corner and joins them", () => {
    const map = cornerMap();
    const checks = checkMap(map);
    const island = checks.find((issue) =>
      issue.id.startsWith("unreachable-island"),
    );
    expect(island).toMatchObject({
      id: "unreachable-island:sector-3",
      message: "Octagon isn't joined to the rest of the map",
      detail:
        "It touches Corridor only at a corner. Rooms join where they share a wall.",
      fixLabel: "Join",
      target: "sector-3",
    });
    const joined = defined(fixIssue(map, defined(island)));
    expect(inspectMap(joined).errors).toEqual([]);
    expect(reachWarnings(joined)).toEqual([]);
    const shared = [...wallOwners(joined)].filter(
      ([, owners]) =>
        owners.some((owner) => owner.id === "sector-2") &&
        owners.some((owner) => owner.id === "sector-3"),
    );
    expect(shared).toHaveLength(2);
  });

  it("names a loose group of rooms once", () => {
    const map = buildMap({
      name: "Apart",
      rooms: [
        room("Hall", 0, 0, 128),
        room("Far", 512, 0, 128),
        room("Farther", 640, 0, 128),
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(reachWarnings(map)).toEqual([
      "Far and 1 room beside it aren't joined to the rest of the map",
    ]);
  });

  it("leaves out loose rooms that something acts on or that are too small", () => {
    const tagged = buildMap({
      name: "Tagged",
      rooms: [
        room("Hall", 0, 0, 128),
        room("Landing", 512, 0, 128, { tag: 2 }),
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(reachWarnings(tagged)).toEqual([]);
    const spots = buildMap({
      name: "Spots",
      rooms: [room("Hall", 0, 0, 128), room("Spots", 512, 0, 128)],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "spawn-spot", at: [576, 64] },
      ],
    });
    expect(reachWarnings(spots)).toEqual([]);
    const tiny = buildMap({
      name: "Tiny",
      rooms: [
        room("Hall", 0, 0, 128),
        { ...room("Tiny", 512, 0, 128), points: rect(512, 0, 24, 24) },
      ],
      things: [{ kind: "player", at: [64, 64] }],
    });
    expect(reachWarnings(tiny)).toEqual([]);
  });

  it("names the items in a loose room but not the room twice", () => {
    const map = buildMap({
      name: "Loose items",
      rooms: [room("Hall", 0, 0, 128), room("Store", 512, 0, 128)],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "stimpack", at: [576, 64] },
      ],
    });
    expect(reachWarnings(map)).toEqual([
      "Store isn't joined to the rest of the map",
      "Store: the player can't reach the stimpack here.",
    ]);
  });
});

function cornerMap(): GameMap {
  return buildMap({
    name: "Corner",
    rooms: [
      room("Hall", 0, 0, 128),
      { ...room("Corridor", 128, 0, 128), points: rect(128, 32, 128, 64) },
      {
        ...room("Octagon", 0, 0, 128),
        points: [
          [256, 64],
          [296, 8],
          [368, -16],
          [440, 8],
          [480, 64],
          [440, 120],
          [368, 144],
          [296, 120],
        ],
      },
    ],
    things: [{ kind: "player", at: [64, 64] }],
  });
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

function reachWarnings(map: GameMap, custom?: CustomThings) {
  return inspectMap(map, { custom })
    .warnings.filter((issue) => issue.id.startsWith("unreachable"))
    .map((issue) => issue.message);
}
