import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Complevel } from "@/lib/map/types";

import { addThing } from "@/lib/map/edit";
import { compileMap } from "@/lib/wad/compile";
import { customThingsOf, customThingWarnings } from "@/lib/wad/custom-things";
import { packWad } from "@/lib/wad/pack";

import {
  launch,
  openMap,
  play,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";

afterEach(stopGames);

const gunner = (attack: string) => `Patch File for DeHackEd v3.0
Doom version = 2021
Patch format = 6

Thing 151 (Gunner)
ID # = 20001
Initial frame = 1100
First moving frame = 1101
Hit points = 100
Speed = 0
Width = 1310720
Height = 3670016
Bits = SOLID+SHOOTABLE+COUNTKILL
MBF21 Bits = NORADIUSDMG

Frame 1100
Sprite number = 29
Duration = 10
Next frame = 1100

Frame 1101
Sprite number = 29
Sprite subnumber = 4
Duration = 10
Next frame = 1101
${attack === "PosAttack" ? "" : "Args3 = 1\nArgs4 = 20\nArgs5 = 1"}

[CODEPTR]
FRAME 1100 = Look
FRAME 1101 = ${attack}
`;
const patchWad = (patch: string) =>
  packWad([{ name: "DEHACKED", data: new TextEncoder().encode(patch) }]);
const modOf = (attack: string) =>
  packWad([
    { name: "DEHACKED", data: new TextEncoder().encode(gunner(attack)) },
  ]);

const freedoom = () =>
  readFileSync(
    resolve(import.meta.dirname, "../../../public/engine/freedoom2.wad"),
  );

describe.skipIf(!ready)("a custom thing in the engine", () => {
  it.each<[string, Complevel, boolean]>([
    ["MonsterBulletAttack", "mbf21", true],
    ["MonsterBulletAttack", "vanilla", false],
    ["PosAttack", "vanilla", true],
  ])(
    "spawns a thing that fires %s at %s",
    async (attack, complevel, fires) => {
      const map = gunnerMap(complevel);
      const mod = modOf(attack);
      const iwad = readFileSync(
        resolve(import.meta.dirname, "../../../public/engine/freedoom2.wad"),
      );
      const wad = compileMap(map, "MAP01", {}, { iwad, resources: [mod] });
      const game = await launch({
        wads: [wad],
        dehacked: [],
        complevel,
        warp: 1,
      });
      await waitForPlay(game);
      expect(game.status().totalKills).toBe(1);
      await play(game, 3000, () => game.status().health < 100);
      expect(game.status().health < 100).toBe(fires);
      expect(
        customThingWarnings(map, customThingsOf([mod])).map(
          (issue) => issue.id,
        ),
      ).toEqual(fires || complevel === "mbf21" ? [] : ["custom-mbf21:20001"]);
    },
    30_000,
  );

  const decoy = patchWad(
    "Thing 152 (Decoy)\nID # = 20001\nBits = SOLID\nInitial frame = 1100\n",
  );
  const barrel = patchWad("Thing 31 (Barrel)\nID # = 20001\n");
  it.each([
    ["a new thing after", [null, decoy], "Decoy"],
    ["a new thing before", [decoy, null], "Gunner"],
    ["one of the game's own after", [null, barrel], "Gunner"],
    ["one of the game's own before", [barrel, null], "Gunner"],
  ])(
    "spawns the right thing for a number shared with %s",
    async (_, order, winner) => {
      const resources = order.map(
        (patch) => patch ?? modOf("MonsterBulletAttack"),
      );
      expect(customThingsOf(resources).get(20001)?.name).toBe(winner);
      const map = gunnerMap("mbf21");
      const wad = compileMap(map, "MAP01", {}, { iwad: freedoom(), resources });
      const game = await launch({
        wads: [wad],
        dehacked: [],
        complevel: "mbf21",
        warp: 1,
      });
      await waitForPlay(game);
      expect(game.status().totalKills).toBe(winner === "Gunner" ? 1 : 0);
    },
    30_000,
  );

  it("drops a number a later patch moves", async () => {
    const resources = [
      modOf("MonsterBulletAttack"),
      patchWad("Thing 151\nID # = 20002\n"),
    ];
    expect([...customThingsOf(resources).keys()]).toEqual([20002]);
    const map = addThing(
      gunnerMap("mbf21"),
      "custom",
      { x: 288, y: 96 },
      180,
      1,
      20002,
    ).map;
    const wad = compileMap(map, "MAP01", {}, { iwad: freedoom(), resources });
    const game = await launch({
      wads: [wad],
      dehacked: [],
      complevel: "mbf21",
      warp: 1,
    });
    await waitForPlay(game);
    expect(game.status().totalKills).toBe(1);
  }, 30_000);
});

function gunnerMap(complevel: Complevel) {
  const alone = {
    ...openMap,
    complevel,
    things: openMap.things.filter((thing) => thing.kind === "player"),
  };
  return addThing(alone, "custom", { x: 288, y: 160 }, 180, 1, 20001).map;
}
