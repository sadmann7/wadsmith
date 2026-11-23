import { describe, expect, it } from "vitest";

import { keyPresets, resolveKeys } from "./keymap";
import { editorShortcuts } from "./shortcuts";

describe("editor shortcuts", () => {
  it("gives every shortcut its own keys in every preset", () => {
    for (const preset of Object.keys(
      keyPresets,
    ) as (keyof typeof keyPresets)[]) {
      const keys = Object.values(resolveKeys({ preset, keys: {} })).filter(
        Boolean,
      );
      expect(new Set(keys).size, preset).toBe(keys.length);
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
