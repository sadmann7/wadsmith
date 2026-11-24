import { describe, expect, it } from "vitest";

import { keyPresets, resolveKeys } from "./keymap";
import {
  type EditorShortcut,
  editorShortcuts,
  getIsScopeShared,
  scopeOf,
} from "./shortcuts";

describe("editor shortcuts", () => {
  it("gives every shortcut its own keys in every preset", () => {
    for (const preset of Object.keys(
      keyPresets,
    ) as (keyof typeof keyPresets)[]) {
      const keys = resolveKeys({ preset, keys: {} });
      const names = Object.keys(keys) as EditorShortcut[];
      const clashes = names.flatMap((name, at) =>
        names
          .slice(at + 1)
          .filter(
            (other) =>
              keys[name] !== "" &&
              keys[name] === keys[other] &&
              getIsScopeShared(scopeOf(name), scopeOf(other)),
          )
          .map((other) => `${name} and ${other}: ${keys[name]}`),
      );
      expect(clashes, preset).toEqual([]);
    }
  });

  it("zooms with = and - in every preset", () => {
    for (const preset of Object.keys(
      keyPresets,
    ) as (keyof typeof keyPresets)[]) {
      const keys = resolveKeys({ preset, keys: {} });
      expect([keys.zoomIn, keys.zoomOut], preset).toEqual(["=", "-"]);
    }
  });

  it("names only shortcuts the table has in a preset", () => {
    for (const { keys } of Object.values(keyPresets)) {
      for (const name of Object.keys(keys)) {
        expect(editorShortcuts).toHaveProperty(name);
      }
    }
  });
});
