import { describe, expect, it } from "vitest";

import type { GameMap, Thing } from "@/lib/map/types";

import { minimapSpan } from "@/lib/engine/runtime";
import { buildMap, rect } from "@/lib/map/featured/build-map";
import { firstLight } from "@/lib/map/featured/first-light";
import { starterMap } from "@/lib/map/starter-map";

import {
  fromEngine,
  heldKeys,
  isInView,
  linesInTiles,
  minimapKeys,
  minimapLines,
  minimapTileRange,
  minimapTiles,
  minimapView,
  secretAreas,
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
        line.from.x === 1520 &&
        line.to.x === 1520 &&
        Math.min(Math.abs(line.from.y), Math.abs(line.to.y)) === 192,
    );
    expect(secret?.kind).toBe("wall");
  });
});

describe("minimapTiles", () => {
  const wall = (key: string, from: [number, number], to: [number, number]) => ({
    key,
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
    kind: "wall" as const,
  });
  const lines = [
    wall("near", [10, 10], [50, 10]),
    wall("edge", [400, 0], [400, 60]),
    wall("far", [5000, 5000], [5100, 5000]),
    wall("long", [-4000, 200], [4000, 200]),
  ];
  const tiles = minimapTiles(lines);
  const drawn = (x: number, y: number) =>
    linesInTiles(tiles, minimapTileRange({ x, y }))
      .map((line) => line.key)
      .sort();

  it("draws the lines around the player and leaves far ones out", () => {
    expect(drawn(0, 0)).toEqual(["edge", "long", "near"]);
    expect(drawn(5050, 5000)).toEqual(["far"]);
  });

  it("draws a line just past the edge before the minimap glides to it", () => {
    expect(minimapSpan / 2 + 64).toBeLessThan(400);
    expect(drawn(-64, 0)).toContain("edge");
  });

  it("draws a long line from any tile it crosses, once", () => {
    expect(drawn(-3000, 200)).toEqual(["long"]);
    expect(drawn(3000, 200)).toEqual(["long"]);
  });

  it("keeps the lines in order as the player crosses tiles", () => {
    const order = (x: number) =>
      linesInTiles(tiles, minimapTileRange({ x, y: 200 })).map((l) => l.key);
    expect(order(0)).toEqual(["near", "edge", "long"]);
    expect(order(-300)).toEqual(["near", "long"]);
  });

  it("draws every line of a map that fits in view", () => {
    const all = minimapLines(starterMap);
    const box = all.flatMap((line) => [line.from, line.to]);
    const center = {
      x:
        (Math.min(...box.map((p) => p.x)) + Math.max(...box.map((p) => p.x))) /
        2,
      y:
        (Math.min(...box.map((p) => p.y)) + Math.max(...box.map((p) => p.y))) /
        2,
    };
    const near = linesInTiles(minimapTiles(all), minimapTileRange(center));
    const inView = all.filter((line) =>
      [line.from, line.to].some((point) =>
        isInView(point, minimapView(center)),
      ),
    );
    expect(near.length).toBeGreaterThanOrEqual(inView.length);
    for (const line of inView) expect(near).toContain(line);
  });
});

describe("secretAreas", () => {
  const named = (ids: string[]) =>
    ids.map(
      (id) => starterMap.sectors.find((sector) => sector.id === id)?.name,
    );

  it("finds the secret room and the secret door that leads to it", () => {
    expect(secretAreas(starterMap).map(named)).toEqual([
      ["Secret", "Secret door"],
    ]);
  });

  it("finds a room marked secret even with no secret line leading to it", () => {
    expect(secretAreas({ ...starterMap, lines: {} }).map(named)).toEqual([
      ["Secret"],
    ]);
    expect(
      secretAreas(firstLight).map((ids) =>
        ids.map((id) => firstLight.sectors.find((s) => s.id === id)?.name),
      ),
    ).toEqual([["Secret"]]);
    expect(secretAreas({ ...starterMap, things: [] })).toEqual([]);
  });

  it("follows teleporters before calling a room secret", () => {
    const room = (name: string, x: number, tag?: number) => ({
      name,
      points: rect(x, 0, 128, 128),
      floor: 0,
      ceiling: 128,
      light: 160,
      floorTexture: "FLOOR4_8",
      ceilingTexture: "CEIL3_5",
      wallTexture: "STARTAN3",
      ...(tag ? { tag } : {}),
    });
    const map = buildMap({
      name: "Teleport",
      rooms: [room("Start", 0), room("Far", 512, 1), room("Hidden", 640)],
      things: [
        { kind: "player", at: [64, 64] },
        { kind: "teleport-destination", at: [576, 64] },
      ],
      lines: [
        {
          wall: [
            [128, 0],
            [128, 128],
          ],
          settings: {
            action: { kind: "teleport", trigger: "walk", repeat: true, tag: 1 },
          },
        },
        {
          wall: [
            [640, 0],
            [640, 128],
          ],
          settings: { secret: true },
        },
      ],
    });
    expect(
      secretAreas(map).map((ids) =>
        ids.map((id) => map.sectors.find((s) => s.id === id)?.name),
      ),
    ).toEqual([["Hidden"]]);
  });

  it("keeps a secret room hidden when a teleporter in it leads back", () => {
    const map = buildMap({
      name: "Return",
      rooms: [
        {
          name: "Start",
          points: rect(0, 0, 128, 128),
          floor: 0,
          ceiling: 128,
          light: 160,
          floorTexture: "FLOOR4_8",
          ceilingTexture: "CEIL3_5",
          wallTexture: "STARTAN3",
          tag: 1,
        },
        {
          name: "Hidden",
          points: rect(128, 0, 128, 128),
          floor: 0,
          ceiling: 128,
          light: 160,
          floorTexture: "FLOOR4_8",
          ceilingTexture: "CEIL3_5",
          wallTexture: "STARTAN3",
        },
      ],
      things: [
        { kind: "player", at: [32, 64] },
        { kind: "teleport-destination", at: [96, 64] },
      ],
      lines: [
        {
          wall: [
            [128, 0],
            [128, 128],
          ],
          settings: { secret: true },
        },
        {
          wall: [
            [256, 0],
            [256, 128],
          ],
          settings: {
            action: { kind: "teleport", trigger: "walk", repeat: true, tag: 1 },
          },
        },
      ],
    });
    expect(
      secretAreas(map).map((ids) =>
        ids.map((id) => map.sectors.find((s) => s.id === id)?.name),
      ),
    ).toEqual([["Hidden"]]);
  });

  it("leaves a secret room's walls off the minimap until it is found", () => {
    const hidden = new Set(secretAreas(starterMap).flat());
    const shown = minimapLines(starterMap, hidden);
    const inSecret = (line: { from: { x: number }; to: { x: number } }) =>
      Math.min(line.from.x, line.to.x) >= 1536;
    expect(minimapLines(starterMap).some(inSecret)).toBe(true);
    expect(shown.some(inSecret)).toBe(false);
    expect(
      shown.find(
        (line) =>
          line.from.x === 1520 &&
          line.to.x === 1520 &&
          Math.min(Math.abs(line.from.y), Math.abs(line.to.y)) === 192,
      )?.kind,
    ).toBe("wall");
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
