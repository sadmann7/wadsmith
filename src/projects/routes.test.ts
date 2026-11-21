import { describe, expect, it } from "vitest";

import { parseRoute, pathOf, type Route } from "./routes";

describe("routes", () => {
  it.each<[string, Route]>([
    ["/", { kind: "home" }],
    ["/maps", { kind: "featured" }],
    ["/episodes/abc", { kind: "episode", id: "abc" }],
    ["/episodes/abc/MAP03", { kind: "map", id: "abc", slot: "MAP03" }],
    ["/maps/furnace-ring", { kind: "featured", map: "furnace-ring" }],
    [
      "/maps/furnace-ring/play",
      { kind: "featured", map: "furnace-ring", play: true },
    ],
    ["/episodes/abc/play", { kind: "episode", id: "abc", play: true }],
    [
      "/episodes/abc/MAP03/play",
      { kind: "map", id: "abc", slot: "MAP03", play: true },
    ],
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
    expect(parseRoute("/maps/play")).toEqual({ kind: "home" });
    expect(parseRoute("/play")).toEqual({ kind: "home" });
  });
});
