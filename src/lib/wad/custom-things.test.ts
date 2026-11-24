import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { runAgentAction } from "@/lib/editor/agent-actions";
import { mapBalance } from "@/lib/map/balance";
import { checkMap } from "@/lib/map/checks";
import { addThing, changeThings, duplicateThings } from "@/lib/map/edit";
import { findChoices, findKeys, similarThings } from "@/lib/map/similar";
import { soundReach } from "@/lib/map/sound";
import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { testMap } from "@/lib/map/test-map";

import { compileMap } from "./compile";
import {
  customThingsOf,
  customThingWarnings,
  modLumps,
  resourceSprites,
  thingCategory,
  thingLabel,
} from "./custom-things";
import { readLumps } from "./inspect";
import { packWad } from "./pack";

const encoder = new TextEncoder();
const patch = encoder.encode(
  "Thing 151 (Plasma Zombie)\nID # = 20001\nBits = COUNTKILL\nInitial frame = 175\n",
);
const lump = (name: string, size = 0) => ({
  name,
  data: new Uint8Array(size),
});
const mod = packWad([
  { name: "DEHACKED", data: patch },
  lump("S_START"),
  lump("SP00A0", 8),
  lump("S_END"),
  lump("DSZOMB", 4),
  lump("BRICK1", 4),
]);
const textures = packWad([lump("BRICK1", 4)]);
const twoThings = packWad([
  {
    name: "DEHACKED",
    data: encoder.encode(
      "Thing 151 (Plasma Zombie)\nID # = 20001\nBits = COUNTKILL\n\nThing 152 (Toxic Barrel)\nID # = 20002\nBits = SOLID\nWidth = 1048576\n",
    ),
  },
]);

describe("custom things", () => {
  it("reads the things an added WAD's patch numbers", () => {
    const things = customThingsOf([textures, mod]);
    expect([...things.keys()]).toEqual([20001]);
    expect(things.get(20001)?.name).toBe("Plasma Zombie");
    expect(thingLabel({ kind: "custom", type: 20001 }, things)).toBe(
      "Plasma Zombie",
    );
    expect(thingLabel({ kind: "custom", type: 5 }, things)).toBe("Thing 5");
  });

  it("judges a custom thing by what its patch makes it", () => {
    const things = customThingsOf([mod]);
    expect(thingCategory({ kind: "custom", type: 20001 }, things)).toBe(
      "enemy",
    );
    expect(thingCategory({ kind: "custom", type: 5 }, things)).toBe("decor");
    expect(thingCategory({ kind: "imp" }, things)).toBe("enemy");
  });

  it("wakes, counts and balances custom monsters like stock ones", () => {
    const custom = customThingsOf([mod]);
    const map: GameMap = {
      ...testMap,
      things: testMap.things.map((thing) =>
        thing.id === "imp-1"
          ? {
              id: thing.id,
              kind: "custom",
              type: 20001,
              x: thing.x,
              y: thing.y,
              angle: 0,
            }
          : thing,
      ),
    };
    const open = { doorsOpen: true };
    expect(soundReach(map, "sector-1", open).woken).toEqual(["zombieman-1"]);
    expect(soundReach(map, "sector-1", { ...open, custom }).woken).toEqual([
      "zombieman-1",
      "imp-1",
    ]);
    expect(mapBalance(map, "medium").enemies).toBe(1);
    expect(mapBalance(map, "medium", custom).enemies).toBe(2);
  });

  it("balances a custom monster by its hit points", () => {
    const tough = customThingsOf([
      packWad([
        {
          name: "DEHACKED",
          data: encoder.encode(
            "Thing 151 (Brute)\nID # = 20001\nBits = COUNTKILL\nHit points = 4000\n",
          ),
        },
      ]),
    ]);
    const crowd: GameMap = {
      ...testMap,
      things: [
        ...testMap.things.filter((thing) => thing.kind === "player"),
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `brute-${index}`,
          kind: "custom" as const,
          type: 20001,
          x: 704,
          y: 160,
          angle: 0,
        })),
      ],
    };
    expect(tough.get(20001)?.health).toBe(4000);
    expect(mapBalance(crowd, "medium", tough).enemies).toBe(3);
    expect(mapBalance(crowd, "medium", tough).ammoShort).toBeGreaterThan(100);
    expect(mapBalance(crowd, "medium").ammoShort).toBe(0);
  });

  it("asks a deathmatch map with custom monsters for an exit", () => {
    const arena: GameMap = {
      ...testMap,
      lines: {},
      things: [
        ...[64, 96, 128, 160].map((x) => ({
          id: `dm-${x}`,
          kind: "deathmatch-start" as const,
          x,
          y: 64,
          angle: 0,
        })),
        {
          id: "monster",
          kind: "custom",
          type: 20001,
          x: 704,
          y: 160,
          angle: 0,
        },
      ],
    };
    const ids = (custom?: ReturnType<typeof customThingsOf>) =>
      checkMap(arena, { custom }).map((issue) => issue.id);
    expect(ids()).not.toContain("no-exit");
    expect(ids(customThingsOf([mod]))).toContain("no-exit");
  });

  it("carries a mod's patch, sprites and sounds", () => {
    expect(modLumps([textures, mod]).map((item) => item.name)).toEqual([
      "DEHACKED",
      "S_START",
      "SP00A0",
      "S_END",
      "DSZOMB",
    ]);
    expect(modLumps([textures])).toEqual([]);
  });

  it("builds a custom thing by its number, with the mod when it is used", () => {
    const names = (map: GameMap) =>
      readLumps({
        name: "map.wad",
        data: compileMap(
          map,
          "MAP01",
          {},
          { iwad: textures, resources: [mod] },
        ),
      }).map((item) => item.name);
    const map = withZombie();
    const things = readLumps({ name: "map.wad", data: compileMap(map) }).find(
      (item) => item.name === "THINGS",
    );
    const view = new DataView(
      things?.data.buffer ?? new ArrayBuffer(0),
      things?.data.byteOffset,
      things?.data.byteLength,
    );
    expect(view.getInt16((map.things.length - 1) * 10 + 6, true)).toBe(20001);
    expect(names(map)).toContain("DEHACKED");
    expect(names(testMap)).not.toContain("DEHACKED");
  });

  it("keeps a custom thing's number when saved", () => {
    const map = withZombie();
    expect(parseMapFile(serializeMap(map)).things.at(-1)).toMatchObject({
      kind: "custom",
      type: 20001,
    });
  });

  it("keeps a custom thing's number when copied, and drops it on a new kind", () => {
    const map = withZombie();
    const zombie = map.things.at(-1)?.id ?? "";
    const copied = duplicateThings(map, [zombie]).map;
    expect(copied.things.at(-1)).toMatchObject({ kind: "custom", type: 20001 });
    const changed = changeThings(map, [zombie], "barrel");
    expect(changed.things.at(-1)?.type).toBeUndefined();
  });

  it("finds the sprites an added WAD carries", () => {
    expect([...resourceSprites([textures, mod]).keys()]).toEqual(["SP00A0"]);
  });

  it("warns about numbers no added patch defines", () => {
    const map = withZombie();
    expect(customThingWarnings(map, customThingsOf([mod]))).toEqual([]);
    expect(
      customThingWarnings(map, new Map()).map((issue) => issue.id),
    ).toEqual(["custom-unknown:20001"]);
    const pusher = addThing(testMap, "custom", { x: 96, y: 128 }, 0, 1, 5001);
    expect(customThingWarnings(pusher.map, new Map())).toEqual([]);
  });

  it("warns when a thing relies on MBF21 and the map is set lower", () => {
    const mbf21 = packWad([
      {
        name: "DEHACKED",
        data: encoder.encode(
          "Thing 151 (Plasma Zombie)\nID # = 20001\nInitial frame = 1100\n\nFrame 1100\nNext frame = 1100\n\n[CODEPTR]\nFRAME 1100 = NoiseAlert\n",
        ),
      },
    ]);
    const custom = customThingsOf([mbf21]);
    const twice = addThing(
      withZombie(),
      "custom",
      { x: 160, y: 128 },
      0,
      1,
      20001,
    ).map;
    expect(customThingWarnings(twice, custom)).toMatchObject([
      { id: "custom-mbf21:20001", message: "Plasma Zombie needs MBF21" },
    ]);
    expect(
      customThingWarnings({ ...twice, complevel: "boom" }, custom),
    ).toHaveLength(1);
    expect(
      customThingWarnings({ ...twice, complevel: "mbf21" }, custom),
    ).toEqual([]);
    expect(customThingWarnings(twice, customThingsOf([mod]))).toEqual([]);
  });
});

describe("custom things by number", () => {
  const custom = customThingsOf([twoThings]);
  const map = [
    { type: 20001, x: 96 },
    { type: 20002, x: 160 },
    { type: 20001, x: 224 },
  ].reduce(
    (next, { type, x }) =>
      addThing(next, "custom", { x, y: 128 }, 0, 1, type).map,
    testMap,
  );
  const ids = (type: number) =>
    map.things
      .filter((thing) => thing.kind === "custom" && thing.type === type)
      .map((thing) => thing.id);

  it("finds each custom thing by its patch's name", () => {
    const found = findChoices(map, "thing", custom).filter((choice) =>
      choice.value.startsWith("custom:"),
    );
    expect(found).toEqual([
      { value: "custom:20001", label: "Plasma Zombie", count: 2 },
      { value: "custom:20002", label: "Toxic Barrel", count: 1 },
    ]);
    expect(findKeys(map, "thing", "custom:20001")).toEqual(
      ids(20001).map((id) => `thing:${id}`),
    );
    expect(
      findChoices(map, "thing").find((item) => item.value === "custom:20002")
        ?.label,
    ).toBe("Thing 20002");
  });

  it("selects only the custom things with the same number", () => {
    expect(similarThings(map, ids(20001).slice(0, 1))).toEqual(ids(20001));
    expect(similarThings(map, ids(20002))).toEqual(ids(20002));
  });

  it("lets the agent list, place and check custom things by number", () => {
    const context = { custom };
    const listed = runAgentAction(map, "listThings", { type: 20001 }, context)
      .result as { items: { id: string; label: string }[] };
    expect(listed.items.map((item) => item.id)).toEqual(ids(20001));
    expect(listed.items[0].label).toBe("Plasma Zombie");
    const every = runAgentAction(map, "listThings", { kind: "custom" }, context)
      .result as { items: unknown[] };
    expect(every.items).toHaveLength(3);
    const catalog = runAgentAction(map, "listCatalog", ["things"], context)
      .result as { kind: string; type?: number; label: string }[];
    expect(catalog.filter((item) => item.kind === "custom")).toEqual([
      {
        kind: "custom",
        type: 20001,
        label: "Plasma Zombie",
        category: "enemy",
      },
      { kind: "custom", type: 20002, label: "Toxic Barrel", category: "decor" },
    ]);
    const placed = runAgentAction(
      map,
      "placeThing",
      { type: 20002, room: "Start room" },
      context,
    );
    expect(placed.map.things.at(-1)).toMatchObject({
      kind: "custom",
      type: 20002,
    });
    const added = runAgentAction(
      map,
      "addThing",
      { type: 20001, x: 64, y: 64 },
      context,
    );
    expect(added.map.things.at(-1)).toMatchObject({
      kind: "custom",
      type: 20001,
    });
    expect(() =>
      runAgentAction(map, "addThing", {
        kind: "imp",
        type: 20001,
        x: 64,
        y: 64,
      }),
    ).toThrow(/custom/);
    const swapped = runAgentAction(
      map,
      "updateThing",
      { thing: ids(20002)[0], kind: "imp" },
      context,
    );
    expect(swapped.map.things.find((t) => t.id === ids(20002)[0])).toEqual(
      expect.not.objectContaining({ type: expect.anything() }),
    );
    const described = runAgentAction(map, "describeMap", [], context)
      .result as { things: Record<string, number> };
    expect(described.things).toMatchObject({
      "custom:20001": 2,
      "custom:20002": 1,
    });
    const warnings = (given: typeof context) =>
      (
        runAgentAction(map, "checkMap", [], given).result as {
          warnings: { id: string }[];
        }
      ).warnings.map((issue) => issue.id);
    expect(warnings(context)).not.toContain("custom-unknown:20001");
    expect(warnings({ custom: new Map() })).toEqual(
      expect.arrayContaining(["custom-unknown:20001", "custom-unknown:20002"]),
    );
  });
});

function withZombie(): GameMap {
  return addThing(testMap, "custom", { x: 96, y: 128 }, 0, 1, 20001).map;
}
