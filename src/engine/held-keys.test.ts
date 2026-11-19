import { describe, expect, it } from "vitest";

import { HeldKeys } from "./held-keys";
import { doomKeys, keysByCode } from "./runtime";

describe("held game keys", () => {
  it("holds a key until every source lets go", () => {
    const keys = new HeldKeys();
    expect(keys.press("Space", doomKeys.fire)).toBe(true);
    expect(keys.press("mouse", doomKeys.fire)).toBe(false);
    expect(keys.release("mouse")).toBeNull();
    expect(keys.release("Space")).toBe(doomKeys.fire);
  });

  it("ignores repeats and releases it never saw", () => {
    const keys = new HeldKeys();
    expect(keys.press("KeyW", doomKeys.up)).toBe(true);
    expect(keys.press("KeyW", doomKeys.up)).toBe(false);
    expect(keys.release("ArrowUp")).toBeNull();
    expect(keys.has("KeyW")).toBe(true);
  });

  it("lists each held game key once", () => {
    const keys = new HeldKeys();
    keys.press("KeyW", doomKeys.up);
    keys.press("ArrowUp", doomKeys.up);
    keys.press("Space", doomKeys.fire);
    expect(keys.keys()).toEqual([doomKeys.up, doomKeys.fire]);
  });

  it("releases everything once", () => {
    const keys = new HeldKeys();
    keys.press("KeyW", doomKeys.up);
    keys.press("ArrowUp", doomKeys.up);
    keys.press("ShiftLeft", doomKeys.run);
    expect(keys.releaseAll()).toEqual([doomKeys.up, doomKeys.run]);
    expect(keys.releaseAll()).toEqual([]);
  });

  it.each([
    ["KeyW", "ArrowUp"],
    ["KeyS", "ArrowDown"],
    ["ControlLeft", "ControlRight"],
    ["ControlLeft", "Space"],
    ["ShiftLeft", "ShiftRight"],
  ])("keeps %s and %s on one game key", (first, second) => {
    expect(keysByCode[first]).toBe(keysByCode[second]);
    const keys = new HeldKeys();
    expect(keys.press(first, keysByCode[first])).toBe(true);
    expect(keys.press(second, keysByCode[second])).toBe(false);
    expect(keys.release(first)).toBeNull();
    expect(keys.release(second)).toBe(keysByCode[first]);
  });
});
