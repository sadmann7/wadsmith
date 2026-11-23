import { describe, expect, it } from "vitest";

import {
  actionForSpecial,
  lineActionKinds,
  lineActions,
  lineSpecial,
  triggerLabel,
  triggerOptions,
} from "./lines";

const openLine = { twoSided: true, doorBehind: false };
const solidLine = { twoSided: false, doorBehind: false };

describe("triggerOptions", () => {
  it("offers each trigger once and repeatable where the action has both", () => {
    expect(
      triggerOptions(
        { kind: "lift", trigger: "switch", repeat: false, tag: 0 },
        openLine,
      ),
    ).toEqual([
      { trigger: "switch", repeat: false },
      { trigger: "switch", repeat: true },
      { trigger: "walk", repeat: false },
      { trigger: "walk", repeat: true },
    ]);
    expect(
      triggerOptions(
        { kind: "floor-raise", trigger: "switch", repeat: false, tag: 0 },
        solidLine,
      ),
    ).toEqual([
      { trigger: "switch", repeat: false },
      { trigger: "switch", repeat: true },
      { trigger: "shoot", repeat: false },
    ]);
  });

  it("follows the specials of the key a locked action needs", () => {
    expect(
      triggerOptions(
        {
          kind: "door-open",
          trigger: "switch",
          repeat: false,
          key: "red",
          tag: 0,
        },
        solidLine,
      ),
    ).toEqual([
      { trigger: "switch", repeat: false },
      { trigger: "switch", repeat: true },
      { trigger: "shoot", repeat: true },
    ]);
  });

  it("names a trigger in plain words", () => {
    expect(triggerLabel("walk", true)).toBe("Walk over, repeatable");
    expect(triggerLabel("switch", false)).toBe("Use once");
  });
});

describe("actionForSpecial", () => {
  it("reads every action's special back to the same action", () => {
    for (const kind of lineActionKinds) {
      const { triggers, keys } = lineActions[kind];
      const specials = [
        ...Object.values(triggers),
        ...Object.values(keys ?? {}).flatMap((colors) => Object.values(colors)),
      ].flatMap(({ once, repeat }) => [once, repeat]);
      for (const special of specials) {
        if (special === undefined) continue;
        const action = actionForSpecial(special, 7);
        expect(action && lineSpecial(action)).toBe(special);
      }
    }
  });

  it("keeps a tag only for an action that uses one", () => {
    expect(actionForSpecial(88, 4)).toEqual({
      kind: "lift",
      trigger: "walk",
      repeat: true,
      tag: 4,
    });
    expect(actionForSpecial(11, 4)).toMatchObject({ kind: "exit", tag: 0 });
    expect(actionForSpecial(26, 4)).toMatchObject({ key: "blue", tag: 0 });
    expect(actionForSpecial(0)).toBeUndefined();
    expect(actionForSpecial(9999)).toBeUndefined();
  });
});
