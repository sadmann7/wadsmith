import { describe, expect, it } from "vitest";

import type { ThingKind } from "./types";

import { checkMap } from "./checks";
import { buildMap, rect } from "./featured/build-map";

describe("co-op starts in another's line of fire", () => {
  it("warns about a start standing in front of another", () => {
    expect(
      inFire([
        ["player", 64, 256, 0],
        ["player-2", 160, 256, 0],
      ]),
    ).toEqual([
      {
        id: "start-in-fire:player-2-1",
        message: "Player 2 start is in the line of fire",
        detail:
          "Player 1 start faces it, so in co-op the first shot hits a teammate. Stand the starts side by side.",
        target: "player-2-1",
      },
    ]);
  });

  it("follows the facing, with north up the map", () => {
    expect(
      inFire([
        ["player", 256, 400, 90],
        ["player-2", 256, 100, 0],
      ]).map(({ target }) => target),
    ).toEqual(["player-2-1"]);
    expect(
      inFire([
        ["player", 256, 100, 90],
        ["player-2", 256, 400, 0],
      ]),
    ).toEqual([]);
  });

  it("leaves starts side by side and ones in other rooms alone", () => {
    expect(
      inFire([
        ["player", 64, 200, 0],
        ["player-2", 64, 248, 0],
        ["player-3", 64, 296, 0],
        ["player-4", 64, 344, 0],
      ]),
    ).toEqual([]);
    expect(
      inFire([
        ["player", 64, 256, 0],
        ["player-2", 700, 256, 0],
      ]),
    ).toEqual([]);
  });

  it("leaves starts outside every room to the outside check", () => {
    expect(
      inFire([
        ["player", 900, 256, 0],
        ["player-2", 960, 256, 0],
      ]),
    ).toEqual([]);
  });

  it("widens the lane with distance, the way a shot spreads", () => {
    const off = (x: number, y: number) =>
      inFire([
        ["player", 32, 256, 0],
        ["player-2", x, y, 0],
      ]).length;
    expect(off(96, 288)).toBe(0);
    expect(off(448, 280)).toBe(1);
  });
});

function inFire(starts: [ThingKind, number, number, number][]) {
  const look = {
    floor: 0,
    ceiling: 128,
    light: 160,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
  };
  const map = buildMap({
    name: "Starts",
    rooms: [
      { name: "Hall", points: rect(0, 0, 512, 512), ...look },
      { name: "Next", points: rect(512, 0, 256, 512), ...look },
    ],
    things: starts.map(([kind, x, y, angle]) => ({
      kind,
      at: [x, y] as [number, number],
      angle,
    })),
  });
  return checkMap(map)
    .filter((issue) => issue.id.startsWith("start-in-fire"))
    .map(({ id, message, detail, target }) => ({
      id,
      message,
      detail,
      target,
    }));
}
