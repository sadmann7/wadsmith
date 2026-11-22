import { describe, expect, it } from "vitest";

import { editorShortcuts } from "./shortcuts";

describe("editor shortcuts", () => {
  it("gives every shortcut its own keys", () => {
    const keys = Object.values(editorShortcuts).map((item) => item.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
