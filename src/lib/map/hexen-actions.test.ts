import { describe, expect, it } from "vitest";

import {
  doomActionFor,
  doomSectorSpecialFor,
  type HexenAction,
  hexenTranslations,
  type HexenTrigger,
} from "./hexen-actions";

const action = (
  special: number,
  args: number[],
  trigger: HexenTrigger,
  repeat = false,
  id = 0,
): HexenAction => ({
  special,
  id,
  args: [...args, 0, 0, 0, 0, 0].slice(0, 5),
  trigger,
  repeat,
});

describe("Hexen line specials", () => {
  it("bring every Doom special back as itself, with its tag", () => {
    for (const [doom, trigger, repeat, special, args] of hexenTranslations) {
      const given = action(
        special,
        args.map((arg) => (arg === "tag" ? 7 : (arg ?? 0))),
        trigger,
        repeat,
        7,
      );
      expect(doomActionFor(given), `special ${doom}`).toEqual({
        special: doom,
        tag: args.includes("tag") ? 7 : 0,
        changes: [],
      });
    }
  });

  it("open a door by its own sector when it names no tag", () => {
    expect(doomActionFor(action(12, [0, 16, 150], "use", true))).toEqual({
      special: 1,
      tag: 0,
      changes: [],
    });
    expect(doomActionFor(action(11, [0, 64], "use"))).toMatchObject({
      special: 118,
    });
    expect(doomActionFor(action(12, [0, 16, 150], "walk"))).toBeNull();
  });

  it("pick the nearest speed and delay and say so", () => {
    expect(doomActionFor(action(12, [3, 48, 150], "use"))).toEqual({
      special: 111,
      tag: 3,
      changes: ["speed"],
    });
    expect(doomActionFor(action(12, [3, 16, 105], "walk", true))).toEqual({
      special: 90,
      tag: 3,
      changes: ["delay"],
    });
    expect(doomActionFor(action(21, [3, 24], "walk"))).toMatchObject({
      special: 38,
      changes: ["speed"],
    });
  });

  it("keep a switch once or repeatable, choosing the other only when Doom has no such one", () => {
    expect(doomActionFor(action(243, [], "use"))).toMatchObject({
      special: 11,
      changes: [],
    });
    expect(doomActionFor(action(243, [], "use", true))).toMatchObject({
      special: 11,
      changes: ["repeat"],
    });
  });

  it("match locked doors by key colour, skull or card", () => {
    expect(doomActionFor(action(13, [0, 16, 150, 129], "use", true))).toEqual({
      special: 28,
      tag: 0,
      changes: [],
    });
    expect(doomActionFor(action(13, [0, 16, 150, 3], "use", true))).toEqual({
      special: 27,
      tag: 0,
      changes: ["key"],
    });
    expect(doomActionFor(action(13, [4, 64, 0, 2], "use"))).toMatchObject({
      special: 133,
      tag: 4,
    });
    expect(doomActionFor(action(13, [0, 16, 150, 100], "use"))).toBeNull();
  });

  it("read the plain lift and crusher specials as their Doom ones", () => {
    expect(doomActionFor(action(62, [5, 32, 105], "walk", true))).toEqual({
      special: 88,
      tag: 5,
      changes: ["height"],
    });
    expect(doomActionFor(action(62, [5, 64, 105], "use"))).toMatchObject({
      special: 122,
    });
    expect(doomActionFor(action(42, [5, 8, 10], "walk"))).toEqual({
      special: 25,
      tag: 5,
      changes: ["speed"],
    });
  });

  it("send teleports, exits and shot lines through their own triggers", () => {
    expect(doomActionFor(action(70, [0, 9], "walk", true))).toEqual({
      special: 97,
      tag: 9,
      changes: [],
    });
    expect(doomActionFor(action(70, [0, 9], "monster-walk"))).toMatchObject({
      special: 125,
    });
    expect(doomActionFor(action(244, [], "walk"))).toMatchObject({
      special: 124,
    });
    expect(doomActionFor(action(243, [], "shoot"))).toMatchObject({
      special: 197,
    });
    expect(doomActionFor(action(215, [0, 8], "walk", false, 8))).toEqual({
      special: 243,
      tag: 8,
      changes: [],
    });
  });

  it("drop what has no Doom equivalent", () => {
    for (const given of [
      action(80, [1], "use"),
      action(12, [3, 16, 150], "none"),
      action(70, [4, 0], "walk"),
      action(23, [3, 8, 64], "walk"),
      action(112, [3, 128], "walk"),
      action(100, [64], "walk"),
      action(215, [1, 2], "walk", true, 1),
      action(215, [0, 0], "walk"),
    ]) {
      expect(doomActionFor(given), JSON.stringify(given)).toBeNull();
    }
  });
});

describe("Hexen generalized specials", () => {
  it("bring every Boom generalized special back from GZDoom's translation", () => {
    for (let boom = 0x2f80; boom < 0x8000; boom += 1) {
      const given = gzdoomForm(boom);
      const expected = boom === 0x4040 ? 40 : boom;
      expect(doomActionFor(given), boom.toString(16)).toEqual({
        special: expected,
        tag: given.args[0],
        changes: [],
      });
    }
  });

  it("pick the nearest speed, height and wait and say so", () => {
    expect(doomActionFor(action(200, [3, 20, 0, 2], "use"))).toEqual({
      special: 0x6000 | 2 | (1 << 3) | (1 << 7),
      tag: 3,
      changes: ["speed"],
    });
    expect(doomActionFor(action(200, [3, 8, 128, 0, 8], "use"))).toEqual({
      special: 0x6000 | 2 | (1 << 6) | (7 << 7),
      tag: 3,
      changes: ["height"],
    });
    expect(doomActionFor(action(202, [3, 16, 1, 0, 1], "use"))).toEqual({
      special: 0x3800 | 2 | (1 << 5) | (1 << 6),
      tag: 3,
      changes: [],
    });
    expect(doomActionFor(action(202, [3, 16, 0, 8, 1], "use"))).toMatchObject({
      special: 0x3800 | 2 | (1 << 6),
      changes: ["delay"],
    });
    expect(doomActionFor(action(204, [3, 4, 8, 0, 1], "use"))).toMatchObject({
      changes: ["stairs reset"],
    });
  });

  it("use a generalized special over a Doom one when monsters can trigger it", () => {
    expect(doomActionFor(action(201, [3, 8, 0, 1, 8], "walk"))).toMatchObject({
      special: 40,
    });
    expect(
      doomActionFor({
        ...action(201, [3, 8, 0, 1, 8], "walk"),
        monsters: true,
      }),
    ).toEqual({
      special: 0x4000 | (1 << 5) | (1 << 6),
      tag: 3,
      changes: [],
    });
  });

  it("keep what Boom can't say as the nearest one", () => {
    expect(doomActionFor(action(202, [3, 16, 2, 34, 1], "use"))).toMatchObject({
      special: 0x3c00 | 2 | (2 << 5) | (1 << 8),
      changes: ["key"],
    });
    expect(
      doomActionFor({
        ...action(200, [3, 8, 0, 2, 1], "walk"),
        monsters: true,
      }),
    ).toMatchObject({
      special: 0x6000 | (1 << 7) | (1 << 10),
      changes: ["monsters"],
    });
    expect(doomActionFor(action(203, [3, 32, 24, 1], "monster-walk"))).toEqual({
      special: 0x3400 | (1 << 3) | (1 << 5) | (1 << 6),
      tag: 3,
      changes: ["trigger"],
    });
    expect(doomActionFor(action(169, [3, 16, 16, 0, 10], "use"))).toEqual({
      special: 0x2f80 | 2 | (1 << 3),
      tag: 3,
      changes: ["where it stops", "crushing"],
    });
  });

  it("say what the nearest one changes", () => {
    const changes = (given: HexenAction) => doomActionFor(given)?.changes;
    expect(changes(action(12, [3, 48, 105], "walk", true))).toEqual([
      "speed",
      "delay",
    ]);
    expect(changes(action(12, [3, 16, 150, 5], "use"))).toEqual(["light"]);
    expect(changes(action(217, [3, 2, 8, 15, 30], "walk"))).toEqual([
      "delay",
      "stairs reset",
    ]);
    expect(changes(action(204, [3, 4, 12], "use"))).toEqual(["step"]);
    expect(changes(action(203, [3, 32, 30, 1], "use"))).toEqual(["delay"]);
    expect(changes(action(205, [3, 16, 16, 0, 10], "use"))).toEqual([
      "where it stops",
    ]);
    expect(changes(action(284, [3, 16, 8, 0, 20], "use"))).toEqual([
      "speed",
      "damage",
    ]);
  });

  it("drop what Boom has no generalized line for", () => {
    for (const given of [
      action(203, [3, 32, 24, 0, 8], "use"),
      action(202, [3, 16, 5], "use"),
      action(202, [3, 16, 0, 34, 102], "use"),
      action(202, [3, 16, 128], "walk"),
      action(200, [0, 8, 0, 2], "walk"),
      action(205, [0, 8, 8], "shoot"),
      action(204, [3, 4, 8], "none"),
      action(225, [0, 0, 0, 8], "none"),
    ]) {
      expect(doomActionFor(given), JSON.stringify(given)).toBeNull();
    }
  });
});

const boomKeyLocks = [100, 1, 2, 3, 4, 5, 6, 101];

// The Hexen special and arguments GZDoom's xlat/base.txt gives a Boom
// generalized special, with the tag as 3.
function gzdoomForm(boom: number): HexenAction {
  const bits = (shift: number, width: number) =>
    (boom >> shift) & ((1 << width) - 1);
  const trigger = boom & 7;
  const isPush = trigger >= 6;
  const tag = isPush ? 0 : 3;
  const speed = bits(3, 2);
  const given = (
    special: number,
    args: number[],
    monsters: boolean,
  ): HexenAction => ({
    special,
    id: 0,
    args,
    trigger: trigger < 2 ? "walk" : trigger < 4 || isPush ? "use" : "shoot",
    repeat: (trigger & 1) === 1,
    monsters,
  });
  if (boom >= 0x4000) {
    const target = bits(7, 3);
    const change = bits(10, 2);
    const model = bits(5, 1);
    return given(
      boom >= 0x6000 ? 200 : 201,
      [
        tag,
        [8, 16, 32, 64][speed],
        target >= 6 ? [24, 32][target - 6] : 0,
        target < 6 ? target + 1 : 0,
        change | (model << 2) | (bits(6, 1) << 3) | (bits(12, 1) << 4),
      ],
      change === 0 && model === 1,
    );
  }
  const doorSpeed = [16, 32, 64, 128][speed];
  const light = isPush ? 128 : 0;
  if (boom >= 0x3c00) {
    return given(
      202,
      [3, doorSpeed, 64 + bits(5, 2) + light, [8, 34, 69, 240][bits(8, 2)], 0],
      bits(7, 1) === 1,
    );
  }
  if (boom >= 0x3800) {
    const kind = bits(5, 1);
    return given(
      202,
      [
        3,
        doorSpeed,
        kind + light,
        kind ? 0 : 34,
        boomKeyLocks[bits(6, 3)] | (bits(9, 1) << 7),
      ],
      false,
    );
  }
  const monsters = bits(5, 1) === 1;
  if (boom >= 0x3400) {
    return given(
      203,
      [tag, doorSpeed, [8, 24, 40, 80][bits(6, 2)], bits(8, 2) + 1, 0],
      monsters,
    );
  }
  if (boom >= 0x3000) {
    return given(
      204,
      [tag, [2, 4, 16, 32][speed], [4, 8, 16, 24][bits(6, 2)], bits(8, 2), 0],
      monsters,
    );
  }
  const crusherSpeed = [8, 16, 32, 64][speed];
  return given(
    284,
    [tag, crusherSpeed, crusherSpeed, bits(6, 1), 10],
    monsters,
  );
}

describe("Hexen sector specials", () => {
  it("become the Doom ones, with Boom's damage, secret and friction bits", () => {
    expect(doomSectorSpecialFor(0)).toBe(0);
    expect(doomSectorSpecialFor(65)).toBe(1);
    expect(doomSectorSpecialFor(81)).toBe(17);
    expect(doomSectorSpecialFor(0x400)).toBe(9);
    expect(doomSectorSpecialFor(0x400 | 72)).toBe(0x80 | 8);
    expect(doomSectorSpecialFor(0x300 | 0x800)).toBe(0x60 | 0x100);
  });

  it("drop the ones Doom doesn't have", () => {
    for (const special of [1, 26, 70, 82, 115, 0x20000]) {
      expect(doomSectorSpecialFor(special), String(special)).toBeNull();
    }
  });
});
