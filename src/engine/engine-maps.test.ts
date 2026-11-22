import { afterEach, describe, expect, it } from "vitest";

import { thingCatalog } from "@/map/catalog";
import { featuredMaps } from "@/map/featured";
import { pointInPolygon, wallKey, wallOwners } from "@/map/geometry";
import { starterMap } from "@/map/starter-map";
import type { GameMap, LineActionKind } from "@/map/types";
import { compileEpisode } from "@/wad/compile";
import { doomKeys, type DoomGame } from "./runtime";
import {
  launch,
  play,
  playerAt,
  pressUse,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";

afterEach(stopGames);

// Stands the player just in front of a wall, inside the given room, facing it.
function facingWall(map: GameMap, from: string, to: string, roomId: string) {
  const a = map.vertices[from];
  const b = map.vertices[to];
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const room = map.sectors.find((sector) => sector.id === roomId)!;
  const polygon = room.vertices.map((id) => map.vertices[id]);
  const inward = pointInPolygon(
    { x: middle.x + normal.x * 8, y: middle.y + normal.y * 8 },
    polygon,
  )
    ? 1
    : -1;
  const x = Math.round(middle.x + normal.x * inward * 36);
  const y = Math.round(middle.y + normal.y * inward * 36);
  // Doom angles turn counter-clockwise with y up, and editor y points down.
  const angle =
    Math.round((Math.atan2(y - middle.y, middle.x - x) * 180) / Math.PI + 360) %
    360;
  return playerAt(map, x, y, angle);
}

type Press = {
  label: string;
  map: GameMap;
  height: (game: DoomGame) => number;
  done: (game: DoomGame, before: number) => boolean;
};

function pressesOf(map: GameMap): Press[] {
  const presses: Press[] = [];
  const owners = wallOwners(map);
  const switchWalls = new Set(
    map.switches.map((item) => wallKey(item.from, item.to)),
  );
  for (const item of map.switches) {
    if (!item.door) continue;
    const door = map.sectors.findIndex((sector) => sector.id === item.door);
    presses.push({
      label: `switch opens ${map.sectors[door].name}`,
      map: facingWall(map, item.from, item.to, item.sector),
      height: (game) => game.sectorCeiling(door),
      done: (game, before) => game.sectorCeiling(door) > before + 56,
    });
  }
  for (const [wall, line] of Object.entries(map.lines ?? {})) {
    const action = line.action;
    if (action?.trigger !== "switch") continue;
    const [from, to] = wall.split("|");
    const target = map.sectors.findIndex((sector) => sector.tag === action.tag);
    const room = switchWalls.has(wall)
      ? map.switches.find((item) => wallKey(item.from, item.to) === wall)!
          .sector
      : owners.get(wall)!.find((sector) => sector.tag !== action.tag)!.id;
    const placed = facingWall(map, from, to, room);
    if (action.kind === "exit" || action.kind === "exit-secret") {
      presses.push({
        label: "exit switch ends the level",
        map: placed,
        height: () => 0,
        done: (game) => !game.status().inLevel,
      });
    } else if (action.kind === "floor-raise-next") {
      presses.push({
        label: `switch raises ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) > before,
      });
    } else if (action.kind === "lift" || action.kind === "lift-fast") {
      presses.push({
        label: `pressing ${wall} lowers ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) < before - 32,
      });
    } else if (action.kind === "floor-lower") {
      presses.push({
        label: `pressing lowers ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) < before - 56,
      });
    } else if (
      action.kind.startsWith("ceiling-lower") ||
      action.kind === "crusher"
    ) {
      presses.push({
        label: `pressing lowers the ceiling of ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorCeiling(target),
        done: (game, before) => game.sectorCeiling(target) < before - 32,
      });
    } else if (action.kind.startsWith("stairs")) {
      presses.push({
        label: `pressing builds stairs from ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) > before,
      });
    } else if (
      action.kind.startsWith("floor-raise") ||
      action.kind === "floor-crush"
    ) {
      presses.push({
        label: `pressing raises ${map.sectors[target].name}`,
        map: placed,
        height: (game) => game.sectorFloor(target),
        done: (game, before) => game.sectorFloor(target) > before + 32,
      });
    }
  }
  return presses;
}

describe.skipIf(!ready)("featured maps in the engine", () => {
  for (const featured of featuredMaps) {
    const quiet: GameMap = {
      ...featured.map,
      things: featured.map.things.filter(
        (thing) => thingCatalog[thing.kind].category !== "enemy",
      ),
    };
    for (const press of pressesOf(quiet)) {
      it(`${featured.title}: ${press.label}`, async () => {
        const game = await launch(press.map);
        await waitForPlay(game);
        const before = press.height(game);
        await pressUse(game);
        await play(game, 6000, () => press.done(game, before));
        expect(press.done(game, before)).toBe(true);
      }, 30_000);
    }
  }
});

async function ticsToFinish(map: GameMap, label: string) {
  const quiet: GameMap = {
    ...map,
    things: map.things.filter(
      (thing) => thingCatalog[thing.kind].category !== "enemy",
    ),
  };
  const press = pressesOf(quiet).find((item) => item.label.startsWith(label))!;
  const game = await launch(press.map);
  await waitForPlay(game);
  const before = press.height(game);
  const start = game.gameTic();
  await pressUse(game);
  await play(game, 6000, () => press.done(game, before));
  expect(press.done(game, before)).toBe(true);
  return game.gameTic() - start;
}

describe.skipIf(!ready)("fast actions in the engine", () => {
  it("lowers a fast lift sooner than a lift", async () => {
    const featured = featuredMaps.find((item) =>
      Object.values(item.map.lines ?? {}).some(
        (line) => line.action?.kind === "lift",
      ),
    )!;
    const lifts = (kind: LineActionKind): GameMap => ({
      ...featured.map,
      lines: Object.fromEntries(
        Object.entries(featured.map.lines ?? {}).map(([wall, line]) => [
          wall,
          line.action?.kind === "lift"
            ? { ...line, action: { ...line.action, kind } }
            : line,
        ]),
      ),
    });
    expect(await ticsToFinish(lifts("lift-fast"), "pressing")).toBeLessThan(
      await ticsToFinish(lifts("lift"), "pressing"),
    );
  }, 60_000);

  it("opens a fast door sooner than a door", async () => {
    const doors = (fast: boolean): GameMap => ({
      ...starterMap,
      sectors: starterMap.sectors.map((sector) =>
        sector.door ? { ...sector, door: { ...sector.door, fast } } : sector,
      ),
    });
    expect(await ticsToFinish(doors(true), "switch opens")).toBeLessThan(
      await ticsToFinish(doors(false), "switch opens"),
    );
  }, 60_000);
});

describe.skipIf(!ready)("floor and ceiling actions in the engine", () => {
  const withLift = (kind: LineActionKind): GameMap => ({
    ...starterMap,
    lines: Object.fromEntries(
      Object.entries(starterMap.lines ?? {}).map(([wall, line]) => [
        wall,
        line.action?.kind === "lift"
          ? { ...line, action: { ...line.action, kind, repeat: false } }
          : line,
      ]),
    ),
  });

  it.each<[LineActionKind, string]>([
    ["ceiling-lower", "pressing lowers the ceiling"],
    ["crusher", "pressing lowers the ceiling"],
    ["floor-crush", "pressing raises"],
    ["stairs", "pressing builds stairs"],
    ["stairs-fast", "pressing builds stairs"],
    ["floor-raise-512", "pressing raises"],
  ])(
    "moves the sector a %s switch targets",
    async (kind, label) => {
      expect(await ticsToFinish(withLift(kind), label)).toBeGreaterThan(0);
    },
    30_000,
  );
});

describe.skipIf(!ready)("a secret exit in the engine", () => {
  it("ends the level", async () => {
    const secret: GameMap = {
      ...starterMap,
      lines: Object.fromEntries(
        Object.entries(starterMap.lines ?? {}).map(([wall, line]) => [
          wall,
          line.action?.kind === "exit"
            ? { ...line, action: { ...line.action, kind: "exit-secret" } }
            : line,
        ]),
      ),
    };
    expect(await ticsToFinish(secret, "exit switch")).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!ready)("an episode in the engine", () => {
  it("moves on to the next map after the tally screen", async () => {
    const [first] = featuredMaps;
    const quiet: GameMap = {
      ...first.map,
      things: first.map.things.filter(
        (thing) => thingCatalog[thing.kind].category !== "enemy",
      ),
    };
    const exit = pressesOf(quiet).find((press) =>
      press.label.startsWith("exit"),
    )!;
    const game = await launch(
      compileEpisode([
        { slot: "MAP01", map: exit.map },
        { slot: "MAP02", map: starterMap },
      ]),
    );
    await waitForPlay(game);
    expect(game.status().map).toBe(1);
    await pressUse(game);
    await play(game, 6000, () => !game.status().inLevel);
    expect(game.status()).toMatchObject({ inLevel: false, map: 1 });
    await play(game, 8000, () => {
      if (game.status().inLevel) return true;
      game.key(game.gameTic() % 8 < 4, doomKeys.use);
      return false;
    });
    game.key(false, doomKeys.use);
    expect(game.status()).toMatchObject({ inLevel: true, map: 2 });
  }, 30_000);
});
