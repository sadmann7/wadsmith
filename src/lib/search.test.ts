import { describe, expect, it } from "vitest";

import { rankByQuery } from "./search";

describe("rankByQuery", () => {
  const names = ["Zombieman", "Shotgun guy", "Imp", "Baron of Hell"];
  const ranked = (query: string) => rankByQuery(names, query, (name) => [name]);

  it("keeps every item for an empty query", () => {
    expect(ranked("  ")).toEqual(names);
  });

  it("finds letters typed in order", () => {
    expect(ranked("sgg")).toEqual(["Shotgun guy"]);
    expect(ranked("boh")).toEqual(["Baron of Hell"]);
  });

  it("puts a match at the start first", () => {
    expect(ranked("im")[0]).toBe("Imp");
  });
});
