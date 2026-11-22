import { describe, expect, it } from "vitest";

import { withPlayerStart } from "./edit";
import {
  formatTics,
  keepRun,
  killersOf,
  markThing,
  parsePlaytest,
  percentOf,
  type PlaytestRun,
  suggestedPar,
} from "./playtest";
import { testMap } from "./test-map";

const run = (tics: number | null, id = "run-1"): PlaytestRun => ({
  id,
  at: 1000,
  players: [0],
  paths: [{ player: 0, points: [0, 0, 8, 0] }],
  marks: [{ kind: "death", player: 0, x: 8, y: 0, tic: 40, value: 3001 }],
  result:
    tics === null
      ? null
      : {
          tics,
          kills: 3,
          totalKills: 4,
          items: 0,
          totalItems: 0,
          secrets: 1,
          totalSecrets: 1,
        },
});

describe("playtest results", () => {
  it("keeps the last run and the fastest exit", () => {
    const first = keepRun(null, run(3000));
    expect(first.best).toBe(3000);
    // A slower run takes the last one's place and leaves the best time.
    const slower = keepRun(first, run(4000, "run-2"));
    expect(slower.run.id).toBe("run-2");
    expect(slower.best).toBe(3000);
    expect(keepRun(slower, run(2000)).best).toBe(2000);
    // A run that never reached the exit, or started somewhere else, sets no
    // time.
    expect(keepRun(null, run(null)).best).toBeNull();
    expect(keepRun(slower, run(null)).best).toBe(3000);
    expect(keepRun(slower, run(100), false).best).toBe(3000);
  });

  it("suggests a par on the game's five-second steps", () => {
    expect(suggestedPar(35 * 61)).toBe(65);
    expect(suggestedPar(35 * 60)).toBe(60);
    expect(suggestedPar(10)).toBe(5);
    expect(formatTics(35 * 95 + 20)).toBe("1:35");
  });

  it("shows a share only where there is something to share", () => {
    expect(percentOf(3, 4)).toBe(75);
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(5, 4)).toBe(100);
  });

  it("names what killed the players, the most frequent first", () => {
    const [death] = run(null).marks;
    expect(markThing(death)).toBe("Imp");
    expect(markThing({ ...death, kind: "pickup", value: 2011 })).toBe(
      "Stimpack",
    );
    const deadly = {
      ...run(null),
      marks: [
        { ...death, value: 0 },
        death,
        { ...death, value: -1 },
        death,
        // A thing the editor doesn't know counts as the level.
        { ...death, value: 9999 },
        { ...death, kind: "damage" as const, value: 3001 },
      ],
    };
    expect(killersOf(deadly)).toEqual([
      { name: "The level", count: 2 },
      { name: "Imp", count: 2 },
      { name: "A player", count: 1 },
    ]);
    expect(killersOf({ ...run(null), marks: [] })).toEqual([]);
  });

  it("reads a stored playtest and refuses what isn't one", () => {
    const saved = keepRun(null, run(3000));
    expect(parsePlaytest(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(parsePlaytest(null)).toBeNull();
    expect(parsePlaytest({ run: { ...run(1), paths: "x" } })).toBeNull();
    expect(
      parsePlaytest({
        run: { ...run(1), paths: [{ player: 0, points: [1, 2, 3] }] },
      }),
    ).toBeNull();
    expect(
      parsePlaytest({ run: { ...run(1), marks: [{ kind: "nap" }] } }),
    ).toBeNull();
    expect(
      parsePlaytest({ run: { ...run(1), result: { tics: -1 } } }),
    ).toBeNull();
  });
});

describe("a playtest from another spot", () => {
  it("moves player one's start and leaves the rest alone", () => {
    const moved = withPlayerStart(testMap, { x: 700.4, y: 150.6 }, -90);
    expect(moved.things[0]).toEqual({
      id: "player-1",
      kind: "player",
      x: 700,
      y: 151,
      angle: 270,
    });
    expect(moved.things.slice(1)).toEqual(testMap.things.slice(1));
    expect(testMap.things[0].x).toBe(96);
  });

  it("adds a start to a map without one", () => {
    const bare = { ...testMap, things: [] };
    expect(withPlayerStart(bare, { x: 8, y: 8 }, 45).things).toEqual([
      { id: "player-1", kind: "player", x: 8, y: 8, angle: 45 },
    ]);
  });
});
