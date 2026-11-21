import { describe, expect, it } from "vitest";

import {
  episodeSlug,
  findEpisode,
  parseRoute,
  pathOf,
  type Route,
} from "./routes";

describe("routes", () => {
  it.each<[string, Route]>([
    ["/", { kind: "home" }],
    ["/maps", { kind: "featured" }],
    ["/episodes/k3j9xq2m", { kind: "episode", id: "k3j9xq2m" }],
    [
      "/episodes/k3j9xq2m/map03",
      { kind: "map", id: "k3j9xq2m", slot: "MAP03" },
    ],
    ["/maps/furnace-ring", { kind: "featured", map: "furnace-ring" }],
    [
      "/maps/furnace-ring/play",
      { kind: "featured", map: "furnace-ring", play: true },
    ],
    [
      "/episodes/k3j9xq2m/play",
      { kind: "episode", id: "k3j9xq2m", play: true },
    ],
    [
      "/episodes/k3j9xq2m/map03/play",
      { kind: "map", id: "k3j9xq2m", slot: "MAP03", play: true },
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

  it("reads an uppercase slot", () => {
    expect(parseRoute("/episodes/k3j9xq2m/MAP07")).toEqual({
      kind: "map",
      id: "k3j9xq2m",
      slot: "MAP07",
    });
  });

  it("gives an older episode id a short, stable address", () => {
    const slug = episodeSlug("first-project");
    expect(slug).toMatch(/^[0-9a-z]{8}$/);
    expect(slug).toBe(episodeSlug("first-project"));
    expect(episodeSlug("9f3a5c21e0d4b6a8c1e2f3a4")).not.toBe(slug);
    expect(pathOf({ kind: "episode", id: "first-project" })).toBe(
      `/episodes/${slug}`,
    );
  });

  it("finds an episode by its address or its stored id", () => {
    const episodes = [{ id: "first-project" }, { id: "k3j9xq2m" }];
    expect(findEpisode(episodes, episodeSlug("first-project"))).toBe(
      episodes[0],
    );
    expect(findEpisode(episodes, "first-project")).toBe(episodes[0]);
    expect(findEpisode(episodes, "k3j9xq2m")).toBe(episodes[1]);
    expect(findEpisode(episodes, "K3J9XQ2M")).toBe(episodes[1]);
    expect(findEpisode(episodes, "missing0")).toBeNull();
  });

  it("sends anything else home", () => {
    expect(parseRoute("/episodes/abc/MAP33")).toEqual({ kind: "home" });
    expect(parseRoute("/elsewhere")).toEqual({ kind: "home" });
    expect(parseRoute("/maps/play")).toEqual({ kind: "home" });
    expect(parseRoute("/play")).toEqual({ kind: "home" });
  });
});
