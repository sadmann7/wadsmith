import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("joins class names and skips empty ones", () => {
    expect(cn("a", false, undefined, "b", null, "")).toBe("a b");
  });

  it("follows a part's state when a class name is a function of it", () => {
    const joined = cn("base", (state: { open: boolean }) =>
      state.open ? "open" : undefined,
    );
    expect(typeof joined).toBe("function");
    if (typeof joined !== "function") return;
    expect(joined({ open: true })).toBe("base open");
    expect(joined({ open: false })).toBe("base");
  });
});
