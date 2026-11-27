import { describe, expect, it } from "vitest";

import type { ThingKind, ThingSkill } from "./types";

import { checkMap } from "./checks";
import { buildMap, rect } from "./featured/build-map";
import { findStuckThings } from "./stuck";

describe("stuck things", () => {
  it("warns about a barrel 8 from a shotgun guy", () => {
    expect(
      stuck([
        ["shotgun-guy", 256, 256],
        ["barrel", 264, 256],
      ]),
    ).toEqual([
      {
        id: "thing-overlap:shotgun-guy-1",
        message: "Shotgun guy overlaps the barrel",
        detail:
          "They're 8 apart and get stuck in each other in Doom. Move them apart.",
        target: "shotgun-guy-1",
      },
    ]);
  });

  it("lets things stand as close as their radii add up to", () => {
    expect(
      stuck([
        ["shotgun-guy", 256, 256],
        ["barrel", 286, 256],
      ]),
    ).toEqual([]);
    expect(
      stuck([
        ["imp", 256, 256],
        ["imp", 296, 296],
      ]),
    ).toEqual([]);
  });

  it("skips things that don't block and things on other difficulties", () => {
    expect(
      stuck([
        ["imp", 256, 256],
        ["candle", 256, 256],
        ["dead-imp", 260, 256],
        ["stimpack", 256, 260],
      ]),
    ).toEqual([]);
    expect(
      stuck([
        ["imp", 256, 256, ["easy"]],
        ["imp", 260, 256, ["hard"]],
      ]),
    ).toEqual([]);
  });

  it("warns about a monster or start with a wall through it", () => {
    expect(stuck([["imp", 10, 256]]).map(({ message }) => message)).toEqual([
      "Imp sticks into a wall",
    ]);
    expect(stuck([["imp", 20, 256]])).toEqual([]);
    expect(
      stuck([["player", 256, 500]], { player: false }).map(
        ({ detail }) => detail,
      ),
    ).toEqual([
      "The player can't move from there in Doom. Move the start away from the wall.",
    ]);
  });

  it("leaves scenery that never moves alone", () => {
    expect(
      stuck([
        ["barrel", 4, 256],
        ["red-torch", 256, 4],
        ["barrel", 256, 256],
        ["barrel", 256, 256],
      ]),
    ).toEqual([]);
  });

  it("leaves Commander Keen against a wall alone", () => {
    expect(stuck([["commander-keen", 10, 256]])).toEqual([]);
  });

  it("says another when both things are the same kind", () => {
    expect(
      stuck([
        ["imp", 256, 256],
        ["imp", 288, 256],
      ]).map(({ message }) => message),
    ).toEqual(["Imp overlaps another imp"]);
  });

  it("checks a map with thousands of things quickly", () => {
    const things: [ThingKind, number, number][] = [];
    for (let x = 0; x < 64; x += 1) {
      for (let y = 0; y < 64; y += 1) {
        things.push(["imp", 8 + x * 7.5, 8 + y * 7.5]);
      }
    }
    const map = buildMap({
      name: "Crowd",
      rooms: [{ name: "Hall", points: rect(0, 0, 512, 512), ...look }],
      things: things.map(([kind, x, y]) => ({ kind, at: [x, y] })),
    });
    // CPU time, unlike wall time, doesn't grow when other work shares the CPU.
    const started = process.threadCpuUsage();
    expect(findStuckThings(map, new Map()).overlaps.length).toBeGreaterThan(0);
    const { user, system } = process.threadCpuUsage(started);
    expect((user + system) / 1000).toBeLessThan(1000);
  });
});

const look = {
  floor: 0,
  ceiling: 128,
  light: 160,
  floorTexture: "FLOOR4_8",
  ceilingTexture: "CEIL3_5",
  wallTexture: "STARTAN3",
};

function stuck(
  things: [ThingKind, number, number, ThingSkill[]?][],
  { player = true } = {},
) {
  const map = buildMap({
    name: "Stuck",
    rooms: [{ name: "Hall", points: rect(0, 0, 512, 512), ...look }],
    things: [
      ...(player
        ? [{ kind: "player" as const, at: [32, 32] as [number, number] }]
        : []),
      ...things.map(([kind, x, y, skills]) => ({
        kind,
        at: [x, y] as [number, number],
        skills,
      })),
    ],
  });
  return checkMap(map)
    .filter((issue) => issue.id.startsWith("thing-"))
    .map(({ id, message, detail, target }) => ({
      id,
      message,
      detail,
      target,
    }));
}
