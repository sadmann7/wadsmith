import { afterEach, describe, expect, it } from "vitest";

import { updateSector } from "@/lib/map/edit";
import { killersOf, markThing, parseRun, runSummary } from "@/lib/map/playtest";

import { doomKeys } from "./runtime";
import {
  launch,
  openMap,
  play,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";
import { RunRecorder } from "./trail";

afterEach(stopGames);

const events = (...rows: number[][]) => Int32Array.from(rows.flat());

describe("a run recorder", () => {
  it("joins steps into a path in the editor's coordinates", () => {
    const recorder = new RunRecorder();
    recorder.add(
      events(
        [0, 0, -1, 1, 1, 2],
        [0, 1, 0, 96, -160, 100],
        [4, 1, 0, 104, -160, 100],
        [8, 1, 0, 120, -150, 100],
      ),
    );
    expect(recorder.run()).toMatchObject({
      players: [0],
      paths: [{ player: 0, points: [96, 160, 104, 160, 120, 150] }],
      marks: [],
      result: null,
    });
  });

  it("says nothing happened before anyone moves", () => {
    const recorder = new RunRecorder();
    recorder.add(events([0, 0, -1, 1, 1, 2], [0, 1, 0, 96, -160, 100]));
    expect(recorder.run()).toBeNull();
  });

  it("starts another path after a teleport, a death and a restart", () => {
    const recorder = new RunRecorder();
    recorder.add(
      events(
        [0, 0, -1, 1, 1, 2],
        [0, 1, 0, 0, 0, 100],
        [4, 1, 0, 8, 0, 100],
        // A teleport lands far away.
        [8, 1, 0, 2000, 0, 100],
        [12, 1, 0, 2008, 0, 100],
        [20, 3, 0, 2008, 0, 3004],
        // The level starts again from the player start.
        [0, 0, -1, 1, 1, 2],
        [0, 1, 0, 0, 0, 100],
        [4, 1, 0, 0, -8, 100],
      ),
    );
    const run = recorder.run();
    expect(run?.paths.map((path) => path.points)).toEqual([
      [0, 0, 8, 0],
      [2000, 0, 2008, 0],
      [0, 0, 0, 8],
    ]);
    expect(run?.marks).toEqual([
      { kind: "death", player: 0, x: 2008, y: 0, tic: 20, value: 3004 },
    ]);
  });

  it("keeps the exit's result when the engine loads the next map", () => {
    const recorder = new RunRecorder();
    recorder.add(
      events(
        [0, 0, -1, 1, 1, 2],
        [0, 1, 0, 0, 0, 100],
        [4, 1, 0, 8, 0, 100],
        [90, 5, -1, 2, 1, 0],
        [90, 6, 0, 2, 1, 0],
        // After the tally and its text, the game's own second map starts.
        [0, 0, -1, 1, 2, 2],
        [0, 1, 0, 5000, 5000, 100],
        [4, 1, 0, 5008, 5000, 100],
      ),
    );
    const run = recorder.run();
    expect(run?.result?.tics).toBe(90);
    expect(run?.paths.map((path) => path.points)).toEqual([[0, 0, 8, 0]]);
    // Nothing later is taken either.
    recorder.add(events([8, 3, 0, 5008, 5000, 0]));
    expect(recorder.run()?.marks).toEqual([]);
  });

  it("counts a burst of hits in one place as one mark", () => {
    const recorder = new RunRecorder();
    recorder.add(
      events(
        [10, 2, 0, 100, -100, 6],
        [12, 2, 0, 104, -100, 9],
        [14, 2, 0, 108, -98, 3],
        // A hit long after, and one somewhere else.
        [200, 2, 0, 108, -98, 20],
        [202, 2, 0, 600, -98, 5],
        [203, 4, 0, 600, -98, 2012],
      ),
    );
    const run = recorder.run();
    expect(run?.marks.map(({ kind, value }) => [kind, value])).toEqual([
      ["damage", 18],
      ["damage", 20],
      ["damage", 5],
      ["pickup", 2012],
    ]);
    expect(run && runSummary(run)).toEqual({
      deaths: 0,
      damage: 43,
      pickups: 1,
    });
  });

  it("adds every player's counts into the result at the exit", () => {
    const recorder = new RunRecorder();
    recorder.add(
      events(
        [0, 1, 0, 0, 0, 100],
        [4, 1, 0, 8, 0, 100],
        [0, 1, 1, 64, 0, 100],
        [4, 1, 1, 72, 0, 100],
        [700, 5, -1, 10, 2, 5],
        [700, 6, 0, 6, 1, 2],
        [700, 6, 1, 3, 0, 1],
      ),
    );
    const run = recorder.run();
    expect(run?.players).toEqual([0, 1]);
    expect(run?.result).toEqual({
      tics: 700,
      kills: 9,
      totalKills: 10,
      items: 3,
      totalItems: 5,
      secrets: 1,
      totalSecrets: 2,
    });
    // A run survives being stored as text.
    expect(parseRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
  });
});

describe.skipIf(!ready)("the engine's trail", () => {
  it("reports where the player walks and what they pick up", async () => {
    const game = await launch(openMap);
    await waitForPlay(game);
    const recorder = new RunRecorder();
    game.key(true, doomKeys.up);
    // The shotgun lies on the way, at 448.
    await play(game, 20_000, () => game.status().x > 500);
    game.key(false, doomKeys.up);
    const trail = game.takeTrail();
    expect(trail).not.toBeNull();
    if (trail) recorder.add(trail);
    expect(game.takeTrail()).toBeNull();
    const run = recorder.run();
    const points = run?.paths[0]?.points ?? [];
    // The path starts on the player start and heads the way the player ran.
    expect(points.slice(0, 2)).toEqual([96, 160]);
    // A step is recorded every few tics, so the last one trails the player.
    expect(points.at(-2)).toBeGreaterThan(420);
    expect(run?.players).toEqual([0]);
    const pickup = run?.marks.find((mark) => mark.kind === "pickup");
    expect(pickup && markThing(pickup)).toBe("Shotgun");
    expect(Math.abs((pickup?.x ?? 0) - 448)).toBeLessThan(64);
    expect(pickup?.y).toBe(160);
    expect(run?.result).toBeNull();
  }, 40_000);

  it("marks where a damaging floor hurt and killed the player", async () => {
    const burning = updateSector(openMap, "sector-1", { effect: "damage-20" });
    const game = await launch(burning);
    await waitForPlay(game);
    const recorder = new RunRecorder();
    // The floor takes 20 a second or so, and the player has 100.
    await play(game, 30_000, () => game.status().health <= 0);
    const trail = game.takeTrail();
    if (trail) recorder.add(trail);
    const run = recorder.run();
    const { deaths, damage } = run ? runSummary(run) : { deaths: 0, damage: 0 };
    expect(deaths).toBe(1);
    expect(damage).toBeGreaterThanOrEqual(100);
    const death = run?.marks.find((mark) => mark.kind === "death");
    expect(death).toMatchObject({ player: 0, x: 96, y: 160, value: 0 });
    expect(run && killersOf(run)).toEqual([{ name: "The level", count: 1 }]);
  }, 60_000);
});
