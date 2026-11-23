import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { addThing, changeThings, duplicateThings } from "@/lib/map/edit";
import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { testMap } from "@/lib/map/test-map";

import { compileMap } from "./compile";
import {
  customThingsOf,
  customThingWarnings,
  modLumps,
  resourceSprites,
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
          "Thing 151 (Plasma Zombie)\nID # = 20001\nMBF21 Bits = NORADIUSDMG\n",
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

function withZombie(): GameMap {
  return addThing(testMap, "custom", { x: 96, y: 128 }, 0, 1, 20001).map;
}
