import { afterEach, describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import {
  launch,
  ready,
  stopGames,
  waitForPlay,
} from "@/lib/engine/test-engine";
import { checkMap } from "@/lib/map/checks";
import { wallKey } from "@/lib/map/geometry";
import { testMap } from "@/lib/map/test-map";
import { compileMap } from "@/lib/wad/compile";

import {
  agentActionNames,
  agentActions,
  runAgentAction,
} from "./agent-actions";

const blank: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

const errorsOf = (map: GameMap) =>
  checkMap(map).filter((issue) => issue.severity === "error");

afterEach(stopGames);

describe("agent actions", () => {
  it("builds a playable map from nothing", () => {
    const { map, results } = firstRooms();
    expect(results[0]).toBe("sector-1");
    expect(results[4]).toBe("sector-3");
    expect(map.sectors.map((sector) => sector.name)).toEqual([
      "Start",
      expect.any(String),
      "Arena",
    ]);
    expect(map.sectors[1].door).toMatchObject({ opensBy: "use" });
    expect(map.things.find((thing) => thing.kind === "imp")).toMatchObject({
      angle: 180,
      skills: ["medium", "hard"],
      ambush: true,
    });

    // The arena's far wall takes the exit switch.
    const arena = runAgentAction(map, "describeRoom", ["Arena"]).result as {
      walls: { wall: string; opensOnto: string | null }[];
      box: { right: number };
    };
    const far = arena.walls.find(({ wall, opensOnto }) => {
      const [a, b] = wall.split("|").map((id) => map.vertices[id]);
      return !opensOnto && a.x === arena.box.right && b.x === arena.box.right;
    });
    expect(far).toBeDefined();
    const done = build(map, [
      ["setLineAction", [far?.wall, "exit", "switch"]],
      ["setMapDetails", { name: "Agent's first" }],
    ]).map;
    expect(done).toEqual(agentMap());
    expect(errorsOf(done)).toEqual([]);
    expect(done.name).toBe("Agent's first");
    expect(compileMap(done).length).toBeGreaterThan(1000);
    const check = runAgentAction(done, "checkMap", ["hard"]).result as {
      errors: unknown[];
      balance: { enemies: number };
    };
    expect(check.errors).toEqual([]);
    expect(check.balance.enemies).toBe(1);
  });

  it("warns where a vanilla map would overflow the original game", () => {
    const size = 14;
    const vertices: GameMap["vertices"] = {};
    for (let row = 0; row <= size; row += 1) {
      for (let column = 0; column <= size; column += 1) {
        vertices[`v${column}-${row}`] = { x: column * 48, y: row * 48 };
      }
    }
    const sectors = Array.from({ length: size * size }, (_, at) => {
      const column = at % size;
      const row = Math.floor(at / size);
      return {
        ...testMap.sectors[0],
        id: `cell-${at}`,
        vertices: [
          `v${column}-${row}`,
          `v${column + 1}-${row}`,
          `v${column + 1}-${row + 1}`,
          `v${column}-${row + 1}`,
        ],
        floor: (at % 24) - 12,
        ceiling: 256,
        light: 96 + ((column + row) % 8) * 16,
      };
    });
    const map: GameMap = { vertices, sectors, things: [], switches: [] };
    const warningsOf = (checked: GameMap) =>
      (
        runAgentAction(checked, "checkMap", []).result as {
          warnings: { id: string }[];
        }
      ).warnings.map((warning) => warning.id.split(":")[0]);
    expect(warningsOf(map)).toContain("vanilla-visplanes");
    expect(warningsOf({ ...map, complevel: "boom" })).not.toContain(
      "vanilla-visplanes",
    );
  });

  it("refuses an edit that would break the map and changes nothing", () => {
    // A room whose walls cross each other.
    expect(() =>
      runAgentAction(testMap, "addRoom", [
        [
          { x: 1100, y: 0 },
          { x: 1228, y: 128 },
          { x: 1228, y: 0 },
          { x: 1100, y: 128 },
        ],
      ]),
    ).toThrow(/would break the map/);
    expect(() =>
      runAgentAction(testMap, "addThing", ["imp", -500, -500]),
    ).toThrow(/outside every room/);
    expect(() =>
      runAgentAction(testMap, "addThing", ["player", 504, 160]),
    ).toThrow(/can't start inside/);
    expect(() =>
      runAgentAction(testMap, "setRoomHeights", ["Start room", 64, 0]),
    ).toThrow(/ceiling must be above/);
    // A door needs a room on each side.
    const lonely = build(blank, [
      [
        "addRoom",
        [
          [
            [0, 0],
            [64, 0],
            [64, 64],
            [0, 64],
          ],
        ],
      ],
    ]).map;
    expect(() => runAgentAction(lonely, "makeDoor", ["sector-1"])).toThrow(
      /door must share a wall/,
    );
  });

  it("lets a door wait for its switch and says what is left to do", () => {
    const { map } = build(testMap, [["removeSwitch", ["switch-1"]]]);
    const waiting = runAgentAction(map, "makeDoor", [
      "Arena door",
      "switch",
      false,
    ]);
    expect(waiting.todo.join(" ")).toMatch(/connect a switch/);
    const wired = runAgentAction(waiting.map, "addDoorSwitch", [
      "Start room",
      "Arena door",
    ]);
    expect(wired.todo).toEqual([]);
    expect(wired.map.switches).toHaveLength(1);
    const placed = wired.map.switches[0];
    expect(wired.result).toEqual({
      switch: placed.id,
      wall: wallKey(placed.from, placed.to),
    });
  });

  it("names rooms, walls and choices it doesn't know", () => {
    expect(() => runAgentAction(testMap, "describeRoom", ["Vault"])).toThrow(
      /No room "Vault"\. Rooms: sector-1 \(Start room\)/,
    );
    expect(() =>
      runAgentAction(testMap, "splitWall", ["v1|v99", 0, 0]),
    ).toThrow(/No wall "v1\|v99"/);
    expect(() =>
      runAgentAction(testMap, "addConnectedRoom", ["Start room", "up"]),
    ).toThrow(/"side" must be one of: north, east, south, west/);
    expect(() =>
      runAgentAction(testMap, "placeThing", ["dragon", "Arena"]),
    ).toThrow(/No thing "dragon"/);
    expect(() => runAgentAction(testMap, "fly", [])).toThrow(
      /No action "fly"\. Actions: help, describeMap/,
    );
    expect(() => runAgentAction(testMap, "removeRoom", [])).toThrow(
      /removeRoom needs "room"/,
    );
    expect(() =>
      runAgentAction(testMap, "removeRoom", { room: "Arena", force: true }),
    ).toThrow(/takes no "force"/);
  });

  it("paints surfaces, sets line sides and wires a lift", () => {
    const { map } = build(testMap, [
      [
        "paintSurface",
        { room: "Start room", surface: "floor", texture: "FLAT5_4" },
      ],
      [
        "paintSurface",
        {
          room: "Start room",
          surface: "wall",
          wall: "v6|v1",
          texture: "BROWN1",
        },
      ],
      ["setLineSide", ["v1|v6", "Start room", 16, 8]],
      ["setLineFlags", { wall: "v3|v4", blocksEnemies: true }],
      ["setLineAction", ["v3|v4", "lift", "walk", "Corridor"]],
    ]);
    expect(map.sectors[0].floorTexture).toBe("FLAT5_4");
    expect(map.sectors[0].wallOverrides).toEqual({ "v1|v6": "BROWN1" });
    expect(map.lines?.["v1|v6"]?.sides?.["sector-1"]).toEqual({
      offsetX: 16,
      offsetY: 8,
    });
    const line = map.lines?.["v3|v4"];
    expect(line?.blocksEnemies).toBe(true);
    expect(line?.action).toMatchObject({ kind: "lift", trigger: "walk" });
    expect(line?.action?.tag).toBe(map.sectors[1].tag);
    expect(line?.action?.tag).toBeGreaterThan(0);
    // An action that moves a room can't go without one, and an exit takes none.
    expect(() =>
      runAgentAction(testMap, "setLineAction", ["v3|v4", "lift", "walk"]),
    ).toThrow(/needs a target room/);
    expect(() =>
      runAgentAction(testMap, "setLineAction", [
        "v1|v6",
        "exit",
        "switch",
        "Arena",
      ]),
    ).toThrow(/takes no target room/);
    // Nothing walks over a solid wall.
    expect(() =>
      runAgentAction(testMap, "setLineAction", ["v1|v6", "exit", "walk"]),
    ).toThrow(/can't be set off by "walk"/);
  });

  it("locks a door behind a key and waits for the key to be placed", () => {
    // The corridor's side of the arena door.
    const locked = runAgentAction(testMap, "setLineAction", {
      wall: "v13|v14",
      kind: "door-raise",
      trigger: "door",
      key: "blue",
    });
    expect(locked.map.lines?.["v13|v14"]?.action).toEqual({
      kind: "door-raise",
      trigger: "door",
      key: "blue",
      repeat: true,
      tag: 0,
    });
    expect(locked.todo.join(" ")).toMatch(/place the blue key/);
    const keyed = runAgentAction(locked.map, "placeThing", [
      "blue-key",
      "Start room",
    ]);
    expect(keyed.todo.join(" ")).not.toMatch(/blue key/);
  });

  it("answers with the wall a switch splits off, which takes its action", () => {
    const added = runAgentAction(testMap, "addSwitch", ["v1|v6"]);
    const { switch: id, wall } = added.result as {
      switch: string;
      wall: string;
    };
    const placed = defined(added.map.switches.find((item) => item.id === id));
    expect(wall).toBe(wallKey(placed.from, placed.to));
    expect(wall).not.toBe("v1|v6");
    const raised = runAgentAction(added.map, "setLineAction", [
      wall,
      "floor-raise-next",
      "switch",
      "Corridor",
    ]);
    expect(raised.map.lines?.[wall]?.action).toMatchObject({
      kind: "floor-raise-next",
      trigger: "switch",
    });
  });

  it("sets flags, a front side and a raw special on a wall", () => {
    // Letting a press pass through is a Boom feature, so a vanilla map
    // refuses it.
    expect(() =>
      runAgentAction(testMap, "setLineFlags", { wall: "v3|v4", passUse: true }),
    ).toThrow(/needs Boom compatibility/);
    const { map } = build(testMap, [
      ["setMapDetails", { complevel: "boom" }],
      [
        "setLineFlags",
        { wall: "v3|v4", mapped: true, passUse: true, room: "Corridor" },
      ],
      ["setLineAction", ["v3|v4", "lift", "walk", "Corridor"]],
      // A raw special takes the action's place on the wall.
      ["setLineSpecial", ["v3|v4", 88, "Corridor"]],
    ]);
    const line = map.lines?.["v3|v4"];
    expect(line).toMatchObject({
      mapped: true,
      passUse: true,
      front: "sector-2",
      raw: { special: 88, tag: map.sectors[1].tag },
    });
    expect(line?.action).toBeUndefined();
    expect(line?.raw?.tag).toBeGreaterThan(0);
    expect(() =>
      runAgentAction(map, "setLineFlags", { wall: "v3|v4", scrolls: true }),
    ).toThrow(/can't scroll/);
    expect(() =>
      runAgentAction(map, "setLineFlags", { wall: "v3|v4", room: "Arena" }),
    ).toThrow(/Arena doesn't have the wall/);
    const cleared = runAgentAction(map, "clearLineAction", ["v3|v4"]).map;
    expect(cleared.lines?.["v3|v4"]?.raw).toBeUndefined();
    expect(cleared.lines?.["v3|v4"]?.mapped).toBe(true);
  });

  it("swaps a texture everywhere, joins a moved corner and sets thing flags", () => {
    const swapped = runAgentAction(testMap, "replaceTexture", [
      "FLAT5_4",
      "FLOOR5_1",
      "flat",
    ]);
    expect(swapped.result).toBe(2);
    expect(swapped.map.sectors[1].floorTexture).toBe("FLOOR5_1");

    // A closet drawn apart from the start room, then pulled onto its corner,
    // which it joins.
    const closet = runAgentAction(testMap, "addRoom", [
      [
        [-200, -100],
        [-100, -100],
        [-100, 0],
      ],
    ]);
    const corner = defined(
      Object.entries(closet.map.vertices).find(
        ([, point]) => point.x === -100 && point.y === 0,
      ),
    )[0];
    const joined = runAgentAction(closet.map, "moveCorner", [corner, 0, 0]).map;
    expect(Object.keys(joined.vertices)).not.toContain(corner);
    expect(joined.sectors.at(-1)?.vertices).toContain("v1");
    // A move that folds a room's walls across each other is refused.
    expect(() =>
      runAgentAction(testMap, "moveCorner", ["v10", 600, 300]),
    ).toThrow(/would break the map/);
    expect(() => runAgentAction(testMap, "moveCorner", ["v99", 0, 0])).toThrow(
      /No corner "v99"/,
    );

    // A friendly monster is an MBF feature, so a vanilla map refuses it.
    expect(() =>
      runAgentAction(testMap, "updateThing", {
        thing: "imp-1",
        friendly: true,
      }),
    ).toThrow(/needs MBF compatibility/);
    const modern = runAgentAction(testMap, "setMapDetails", {
      complevel: "mbf",
    }).map;
    const flagged = runAgentAction(modern, "updateThing", {
      thing: "imp-1",
      notCoop: true,
      friendly: true,
      skills: ["hard"],
      angle: -90,
    }).map;
    expect(flagged.things.find((thing) => thing.id === "imp-1")).toMatchObject({
      notCoop: true,
      friendly: true,
      skills: ["hard"],
      angle: 270,
    });
    const tamed = runAgentAction(flagged, "updateThing", {
      thing: "imp-1",
      friendly: false,
      skills: ["easy", "medium", "hard"],
    }).map.things.find((thing) => thing.id === "imp-1");
    expect(tamed?.friendly).toBeUndefined();
    expect(tamed?.skills).toBeUndefined();
  });

  it("keeps things inside rooms while the map is unfinished", () => {
    const square = (x: number) => [
      [x, 0],
      [x + 128, 0],
      [x + 128, 128],
      [x, 128],
    ];
    const { map } = build(blank, [
      ["addRoom", [square(0)]],
      ["addRoom", [square(512)]],
      ["placeThing", ["imp", "sector-2"]],
    ]);
    // No player start yet, and removing the imp's room would strand it.
    expect(() => runAgentAction(map, "removeRoom", ["sector-2"])).toThrow(
      /imp-1 is outside every room/,
    );
  });

  it("checks texture names against the game's when it knows them", () => {
    const context = {
      names: {
        walls: ["STARTAN3"],
        flats: ["FLOOR4_8", "CEIL3_5"],
        middles: [],
        textures: ["STARTAN3", "BROWN1", "METAL", "BIGDOOR2", "SW1STRTN"],
        custom: [],
      },
    };
    const known = runAgentAction(
      testMap,
      "updateRoom",
      { room: "Start room", wallTexture: "BROWN1" },
      context,
    );
    expect(known.map.sectors[0].wallTexture).toBe("BROWN1");
    expect(() =>
      runAgentAction(
        testMap,
        "updateRoom",
        { room: "Start room", wallTexture: "NOPE" },
        context,
      ),
    ).toThrow(/has no texture called NOPE/);
    // Without the game's names, any name goes.
    expect(
      runAgentAction(testMap, "updateRoom", {
        room: "Start room",
        wallTexture: "NOPE",
      }).map.sectors[0].wallTexture,
    ).toBe("NOPE");
  });

  it("reads the map without changing it", () => {
    const overview = runAgentAction(testMap, "describeMap");
    expect(overview.map).toBe(testMap);
    expect(overview.result).toMatchObject({
      roomCount: 4,
      rooms: [
        { id: "sector-1", name: "Start room" },
        { id: "sector-2" },
        { id: "sector-3" },
        { id: "sector-4" },
      ],
      things: { player: 1, imp: 1 },
    });
    const things = runAgentAction(testMap, "listThings", ["Arena"]).result;
    expect(things).toMatchObject({
      total: 2,
      items: [{ id: "zombieman-1" }, { id: "imp-1" }],
    });
    const rooms = runAgentAction(testMap, "listRooms", [
      { x: 800, y: 0, limit: 2 },
    ]).result;
    expect(rooms).toMatchObject({
      total: 4,
      items: [{ id: "sector-3" }, { door: "switch" }],
      next: 2,
    });
    const catalog = runAgentAction(testMap, "listCatalog", ["line-actions"])
      .result as { kind: string; needsRoom: boolean }[];
    expect(catalog.find((item) => item.kind === "exit")?.needsRoom).toBe(false);
    expect(catalog.find((item) => item.kind === "lift")?.needsRoom).toBe(true);
    const help = runAgentAction(testMap, "help").result as { name: string }[];
    expect(help.map((item) => item.name)).toEqual(agentActionNames);
  });

  it("describes every action and parameter", () => {
    for (const action of agentActions) {
      expect(action.description.length).toBeGreaterThan(10);
      for (const param of action.params) {
        expect(param.description.length).toBeGreaterThan(3);
      }
      // A required parameter never follows an optional one, so positional
      // arguments stay in order.
      const firstOptional = action.params.findIndex((param) => param.optional);
      const lastRequired = action.params.findLastIndex(
        (param) => !param.optional,
      );
      expect(firstOptional === -1 || firstOptional > lastRequired).toBe(true);
    }
    expect(new Set(agentActionNames).size).toBe(agentActionNames.length);
  });
});

describe.skipIf(!ready)("a map built by agent actions in the engine", () => {
  it("loads with the player at the start and the imp waiting", async () => {
    const game = await launch(agentMap());
    await waitForPlay(game);
    expect(game.status()).toMatchObject({
      inLevel: true,
      health: 100,
      x: 64,
      y: -128,
      totalKills: 1,
    });
  }, 30_000);
});

// A start room, a door and an arena with an imp in it.
function firstRooms() {
  return build(blank, [
    [
      "addRoom",
      {
        corners: [
          { x: 0, y: 0 },
          { x: 256, y: 0 },
          { x: 256, y: 256 },
          { x: 0, y: 256 },
        ],
        name: "Start",
        wallTexture: "STARTAN3",
      },
    ],
    ["addThing", ["player", 64, 128]],
    ["addConnectedRoom", ["Start", "east", 32]],
    ["makeDoor", ["sector-2"]],
    ["addConnectedRoom", ["sector-2", "east", 384]],
    [
      "updateRoom",
      { room: "sector-3", name: "Arena", ceiling: 192, light: 208 },
    ],
    ["placeThing", ["imp", "Arena", 180, ["medium", "hard"], true]],
    ["addThing", { kind: "shotgun", x: 128, y: 128 }],
  ]);
}

// Runs steps one after another, as an agent would, and keeps what each said.
function build(start: GameMap, steps: [string, unknown[] | object][]) {
  let map = start;
  const results: unknown[] = [];
  for (const [name, args] of steps) {
    const outcome = runAgentAction(map, name, args as unknown[]);
    ({ map } = outcome);
    results.push(outcome.result);
  }
  return { map, results };
}

// The same rooms finished with an exit switch on the arena's far wall, which
// the agent finds by reading the room.
function agentMap() {
  const { map } = firstRooms();
  const arena = runAgentAction(map, "describeRoom", ["Arena"]).result as {
    walls: { wall: string; opensOnto: string | null }[];
    box: { right: number };
  };
  const far = arena.walls.find(({ wall, opensOnto }) => {
    const [a, b] = wall.split("|").map((id) => map.vertices[id]);
    return !opensOnto && a.x === arena.box.right && b.x === arena.box.right;
  });
  return build(map, [
    ["setLineAction", [far?.wall, "exit", "switch"]],
    ["setMapDetails", { name: "Agent's first" }],
  ]).map;
}
