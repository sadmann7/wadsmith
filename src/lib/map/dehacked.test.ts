import { describe, expect, it } from "vitest";

import { parseDehacked } from "./dehacked";

const patch = `Patch File for DeHackEd v3.0
# A comment line.
Doom version = 2016
Patch format = 6

Thing 151 (Plasma Zombie)
ID # = 20001
Initial frame = 1100
Width = 1310720
Height = 3670016
Bits = SOLID+SHOOTABLE+COUNTKILL

Frame 1100
Sprite number = 146
Sprite subnumber = 32769

Thing 12 (Imp)
Hit points = 100

Text 4 6
Thing 999
ID # = 1

Thing 152
ID # = 20002
Bits = 1
Initial frame = 175

[SPRITES]
SP01 = ZOMB
`;

describe("parseDehacked", () => {
  it("finds the things a patch gives editor numbers", () => {
    expect(parseDehacked(patch)).toEqual([
      {
        type: 20001,
        name: "Plasma Zombie",
        radius: 20,
        height: 56,
        category: "enemy",
        sprite: "ZOMBB",
        isMbf21: false,
      },
      {
        type: 20002,
        name: "Thing 152",
        radius: 20,
        height: 16,
        category: "item",
        sprite: "POSSA",
        isMbf21: false,
      },
    ]);
  });

  it("keeps a vanilla thing's size and look when a patch only renumbers it", () => {
    expect(parseDehacked("Thing 12 (Imp)\nID # = 30000\n")).toEqual([
      {
        type: 30000,
        name: "Imp",
        radius: 20,
        height: 56,
        category: "enemy",
        sprite: "TROOA",
        isMbf21: false,
      },
    ]);
  });

  it("adds a thing's fields up across blocks, and leaves out what can't be saved", () => {
    const things = parseDehacked(
      "Thing 151 (Split)\nID # = 20001\n\nThing 151\nInitial frame = 1100\n\nFrame 1100\nSprite number = 145\n\nThing 152\nID # = 20002\n\nThing 153\nID # = 40000\n",
    );
    expect(
      things.map(({ type, name, sprite }) => ({ type, name, sprite })),
    ).toEqual([
      { type: 20001, name: "Split", sprite: "SP00A" },
      { type: 20002, name: "Thing 152", sprite: null },
    ]);
  });

  it("notices the MBF21 features a thing relies on", () => {
    const mbf21 = (patch: string) =>
      Object.fromEntries(
        parseDehacked(patch).map((thing) => [thing.name, thing.isMbf21]),
      );
    expect(
      mbf21(`Thing 151 (Flags)
ID # = 20001
MBF21 Bits = NORADIUSDMG

Thing 152 (Gunner)
ID # = 20002
Initial frame = 1100

Thing 153 (Plain)
ID # = 20003
Initial frame = 1200

Frame 1100
Next frame = 1101

Frame 1101
Next frame = 1100

Frame 1200
Next frame = 1200

[CODEPTR]
FRAME 1101 = A_MonsterBulletAttack
`),
    ).toEqual({ Flags: true, Gunner: true, Plain: false });
    expect(
      mbf21(
        "Thing 153 (Plain)\nID # = 20003\nInitial frame = 1200\n\nFrame 1200\nNext frame = 1200\n\nFrame 1300\nArgs1 = 5\n",
      ),
    ).toEqual({ Plain: false });
    expect(
      mbf21("Thing 12 (Imp)\nID # = 30000\n\nFrame 1300\nArgs1 = 5\n"),
    ).toEqual({ Imp: true });
    expect(
      mbf21("Thing 12 (Imp)\nID # = 30000\n\n[CODEPTR]\nFRAME 1300 = Look\n"),
    ).toEqual({ Imp: false });
  });

  it("applies patches in order, with the last named thing taking a shared number", () => {
    const names = (...patches: string[]) =>
      parseDehacked(...patches).map(({ type, name }) => [type, name]);
    const moved = "Thing 151\nID # = 20002\n";
    expect(names("Thing 151 (Gunner)\nID # = 20001\n", moved)).toEqual([
      [20002, "Gunner"],
    ]);
    expect(
      names(
        "Thing 152 (Decoy)\nID # = 20001\n",
        "Thing 151 (Gunner)\nID # = 20001\n\nThing 12 (Imp)\nID # = 20001\n",
      ).at(-1),
    ).toEqual([20001, "Gunner"]);
  });
});
