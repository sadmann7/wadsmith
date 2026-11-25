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
): HexenAction => ({
  special,
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
      );
      expect(doomActionFor(given), `special ${doom}`).toEqual({
        special: doom,
        tag: args.includes("tag") ? 7 : 0,
        isNearest: false,
      });
    }
  });

  it("open a door by its own sector when it names no tag", () => {
    expect(doomActionFor(action(12, [0, 16, 150], "use", true))).toEqual({
      special: 1,
      tag: 0,
      isNearest: false,
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
      isNearest: true,
    });
    expect(doomActionFor(action(12, [3, 16, 105], "walk", true))).toEqual({
      special: 90,
      tag: 3,
      isNearest: true,
    });
    expect(doomActionFor(action(21, [3, 24], "walk"))).toMatchObject({
      special: 38,
      isNearest: true,
    });
  });

  it("keep a switch once or repeatable, choosing the other only when Doom has no such one", () => {
    expect(doomActionFor(action(243, [], "use"))).toMatchObject({
      special: 11,
      isNearest: false,
    });
    expect(doomActionFor(action(243, [], "use", true))).toMatchObject({
      special: 11,
      isNearest: true,
    });
  });

  it("match locked doors by key colour, skull or card", () => {
    expect(doomActionFor(action(13, [0, 16, 150, 129], "use", true))).toEqual({
      special: 28,
      tag: 0,
      isNearest: false,
    });
    expect(doomActionFor(action(13, [0, 16, 150, 3], "use", true))).toEqual({
      special: 27,
      tag: 0,
      isNearest: true,
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
      isNearest: true,
    });
    expect(doomActionFor(action(62, [5, 64, 105], "use"))).toMatchObject({
      special: 122,
    });
    expect(doomActionFor(action(42, [5, 8, 10], "walk"))).toMatchObject({
      special: 25,
      tag: 5,
    });
  });

  it("send teleports, exits and shot lines through their own triggers", () => {
    expect(doomActionFor(action(70, [0, 9], "walk", true))).toEqual({
      special: 97,
      tag: 9,
      isNearest: false,
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
    expect(doomActionFor(action(215, [3, 8], "walk"))).toEqual({
      special: 243,
      tag: 8,
      isNearest: false,
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
    ]) {
      expect(doomActionFor(given), JSON.stringify(given)).toBeNull();
    }
  });
});

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
