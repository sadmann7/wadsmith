import { describe, expect, it } from "vitest";

import { parseRoute, pathOf, type Route } from "./routes";

describe("routes", () => {
  it.each<[string, Route]>([
    ["/", { kind: "home" }],
    ["/maps", { kind: "featured" }],
    ["/episodes/abc", { kind: "episode", id: "abc" }],
    ["/episodes/abc/MAP03", { kind: "map", id: "abc", slot: "MAP03" }],
  ])("round-trips %s", (path, route) => {
    expect(parseRoute(path)).toEqual(route);
    expect(pathOf(route)).toBe(path);
  });

  it("reads a lowercase slot and a trailing slash", () => {
    expect(parseRoute("/episodes/abc/map07/")).toEqual({
      kind: "map",
      id: "abc",
      slot: "MAP07",
    });
  });

  it("sends anything else home", () => {
    expect(parseRoute("/episodes/abc/MAP33")).toEqual({ kind: "home" });
    expect(parseRoute("/elsewhere")).toEqual({ kind: "home" });
  });
});
