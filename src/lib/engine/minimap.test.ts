import { describe, expect, it } from "vitest";

import type { GameMap, Thing } from "@/lib/map/types";

import { minimapSpan } from "@/lib/engine/runtime";
import { starterMap } from "@/lib/map/starter-map";

import {
  fromEngine,
  heldKeys,
  isInView,
  minimapKeys,
  minimapLines,
  minimapView,
  showsCrosshair,
} from "./minimap";

describe("minimapView", () => {
  it("centers a fixed span on the player instead of fitting the map", () => {
    const player = fromEngine({ x: 816, y: -152 });
    expect(player).toEqual({ x: 816, y: 152 });
    expect(minimapView(player)).toEqual({
      x: 816 - minimapSpan / 2,
      y: 152 - minimapSpan / 2,
      width: minimapSpan,
      height: minimapSpan,
    });
  });

  it("keeps things near the player and drops the ones past the edge", () => {
    const view = minimapView({ x: 0, y: 0 }, 200);
    expect(isInView({ x: 100, y: -100 }, view)).toBe(true);
    expect(isInView({ x: 110, y: 0 }, view)).toBe(false);
    expect(isInView({ x: 110, y: 0 }, view, 16)).toBe(true);
  });
});

describe("minimapLines", () => {
  const lines = minimapLines(starterMap);
  const kinds = (kind: string) => lines.filter((line) => line.kind === kind);

  it("colors a locked door's faces with its key", () => {
    const locked = lines.filter((line) => line.lock);
    expect(locked).toHaveLength(2);
    expect(locked.every((line) => line.kind === "door")).toBe(true);
    expect(locked.every((line) => line.lock === "blue")).toBe(true);
  });

  it("draws plain doors, the exit switch and steps", () => {
    expect(kinds("door").filter((line) => !line.lock).length).toBeGreaterThan(
      0,
    );
    expect(kinds("exit")).toHaveLength(1);
    expect(kinds("step").length).toBeGreaterThan(0);
  });

  it("draws a secret door as a plain wall", () => {
    const secret = lines.find(
      (line) =>
        line.from.y === -96 &&
        line.to.y === -96 &&
        Math.min(line.from.x, line.to.x) === 1056,
    );
    expect(secret?.kind).toBe("wall");
  });
});

describe("keys", () => {
  const solo = { skill: "medium" as const, mode: "solo" as const };

  it("reads the engine's key bits in Doom's order", () => {
    expect(heldKeys(0)).toEqual([]);
    expect(heldKeys(0b100101)).toEqual([
      { color: "blue", skull: false },
      { color: "red", skull: false },
      { color: "red", skull: true },
    ]);
  });

  it("leaves a key off the minimap once the player holds it", () => {
    expect(minimapKeys(starterMap, 0, solo)).toEqual([
      expect.objectContaining({ color: "blue", skull: false }),
    ]);
    expect(minimapKeys(starterMap, 1, solo)).toEqual([]);
    expect(minimapKeys(starterMap, 0b1000, solo)).toHaveLength(1);
  });

  it("leaves out keys this skill or game mode never spawns", () => {
    const keyed = (change: Partial<Thing>): GameMap => ({
      ...starterMap,
      things: starterMap.things.map((thing) =>
        thing.kind === "blue-key" ? { ...thing, ...change } : thing,
      ),
    });
    const hardOnly = keyed({ skills: ["hard"] });
    expect(minimapKeys(hardOnly, 0, solo)).toEqual([]);
    expect(minimapKeys(hardOnly, 0, { ...solo, skill: "hard" })).toHaveLength(
      1,
    );
    const multiplayer = keyed({ multiplayer: true });
    expect(minimapKeys(multiplayer, 0, solo)).toEqual([]);
    expect(minimapKeys(multiplayer, 0, { ...solo, mode: "coop" })).toHaveLength(
      1,
    );
    expect(
      minimapKeys(keyed({ notCoop: true }), 0, { ...solo, mode: "coop" }),
    ).toEqual([]);
    expect(minimapKeys(starterMap, 0, { ...solo, mode: "deathmatch" })).toEqual(
      [],
    );
  });
});

describe("showsCrosshair", () => {
  const aiming = {
    enabled: true,
    mouseMode: "locked" as const,
    inLevel: true,
    health: 100,
    automap: false,
    covered: false,
  };

  it("shows while the mouse aims a living player in a level", () => {
    expect(showsCrosshair(aiming)).toBe(true);
  });

  it.each([
    ["turned off", { enabled: false }],
    ["the mouse is released", { mouseMode: "released" as const }],
    ["the mouse can't be captured", { mouseMode: "denied" as const }],
    ["between levels", { inLevel: false }],
    ["the player is dead", { health: 0 }],
    ["the automap is open", { automap: true }],
    ["a panel covers the view", { covered: true }],
  ])("hides when %s", (_, change) => {
    expect(showsCrosshair({ ...aiming, ...change })).toBe(false);
  });
});
