import { describe, expect, it } from "vitest";

import {
  bindingProblem,
  bindKeys,
  defaultKeys,
  keysFromEvent,
  parseSavedKeys,
  resolveKeys,
} from "./keymap";

describe("keymap", () => {
  it("lays saved keys over the preset over the defaults", () => {
    const keys = resolveKeys({ preset: "udb", keys: { find: "mod+k" } });
    expect(keys.vertices).toBe("v");
    expect(keys.makeDoor).toBe("shift+d");
    expect(keys.drawLine).toBe("");
    expect(keys.find).toBe("mod+k");
  });

  it("takes keys from the action that had them", () => {
    const { saved, taken } = bindKeys(defaultKeys, "find", "g");
    expect(taken).toEqual(["snap", "sceneFly"]);
    const keys = resolveKeys(saved);
    expect(keys.find).toBe("g");
    expect(keys.snap).toBe("");
  });

  it("lets a map key and a 3D view key share a key", () => {
    const { saved, taken } = bindKeys(defaultKeys, "snap", "b");
    expect(taken).toEqual([]);
    expect(resolveKeys(saved).sceneFullbright).toBe("b");
  });

  it("keeps the 3D view's walking keys for walking", () => {
    expect(bindingProblem("sceneFly", "w")).not.toBeNull();
    expect(bindingProblem("help", "space")).not.toBeNull();
    expect(bindingProblem("snap", "w")).toBeNull();
    expect(bindingProblem("sceneFly", "h")).toBeNull();
  });

  it("leaves other actions alone when unbinding", () => {
    const { saved, taken } = bindKeys(defaultKeys, "snap", "");
    expect(taken).toEqual([]);
    expect(resolveKeys(saved).snap).toBe("");
    expect(resolveKeys(saved).clearSelection).toBe("");
  });

  it("reads back only what it knows", () => {
    expect(parseSavedKeys("not json")).toEqual(defaultKeys);
    expect(
      parseSavedKeys(
        JSON.stringify({
          preset: "other",
          keys: { find: "f3", nope: "x", undo: 4 },
        }),
      ),
    ).toEqual({ preset: "wadsmith", keys: { find: "f3" } });
  });

  it("turns a key press into a shortcut by position", () => {
    const press = (init: Partial<KeyboardEvent>) =>
      ({
        key: "",
        code: "",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...init,
      }) as KeyboardEvent;
    expect(
      keysFromEvent(press({ key: "©", code: "KeyG", altKey: true }), true),
    ).toEqual({ keys: "alt+g" });
    expect(
      keysFromEvent(press({ key: "d", code: "KeyD", metaKey: true }), true),
    ).toEqual({ keys: "mod+d" });
    expect(
      keysFromEvent(press({ key: "d", code: "KeyD", ctrlKey: true }), false),
    ).toEqual({ keys: "mod+d" });
    expect(keysFromEvent(press({ key: "F3", code: "F3" }), false)).toEqual({
      keys: "f3",
    });
    expect(
      keysFromEvent(press({ key: "Shift", code: "ShiftLeft" }), false),
    ).toBe(null);
    expect(keysFromEvent(press({ key: "a", code: "KeyQ" }), false)).toEqual({
      keys: "a",
    });
    expect(
      keysFromEvent(
        press({ key: "{", code: "BracketLeft", shiftKey: true }),
        false,
      ),
    ).toEqual({ keys: "shift+{" });
    expect(
      keysFromEvent(
        press({ key: "“", code: "BracketLeft", altKey: true }),
        true,
      ),
    ).toHaveProperty("problem");
    expect(
      keysFromEvent(press({ key: "Tab", code: "Tab" }), false),
    ).toHaveProperty("problem");
    expect(
      keysFromEvent(press({ key: "c", code: "KeyC", metaKey: true }), true),
    ).toHaveProperty("problem");
    expect(
      keysFromEvent(
        press({ key: "Backspace", code: "Backspace", metaKey: true }),
        true,
      ),
    ).toHaveProperty("problem");
    expect(
      keysFromEvent(press({ key: "w", code: "KeyW", ctrlKey: true }), false),
    ).toHaveProperty("problem");
  });
});
