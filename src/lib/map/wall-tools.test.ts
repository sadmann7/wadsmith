import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import type { GameMap } from "./types";

import { updateLineSide, updateSector } from "./edit";
import { sectorAt, wallOwners, wallPartTexture } from "./geometry";
import { describeLine } from "./lines";
import { drawRoom } from "./reshape";
import { validateMap } from "./validate";
import {
  curveWalls,
  flipWalls,
  splitIntoSteps,
  stairRooms,
  swapWallSides,
} from "./wall-tools";

const empty: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };
const hall = drawRoom(empty, box(0, 0, 512, 256), {}, 1);

describe("curving walls", () => {
  it("bends a wall out of its room into that many segments", () => {
    const curved = curveWalls(hall.map, ["v1|v2"], 8, 64);
    expect(curved.sectors[0].vertices).toHaveLength(4 + 7);
    // The top wall bulged away from the room, upwards.
    const lowest = Math.min(...Object.values(curved.vertices).map((p) => p.y));
    expect(lowest).toBe(-64);
    expect(problems(curved)).toEqual([]);
  });

  it("bends a nested room's wall away from the room in front", () => {
    const inner = drawRoom(hall.map, box(128, 64, 256, 192), {}, 1);
    const flipped = flipWalls(inner.map, ["v5|v6"]);
    const curved = curveWalls(flipped, ["v5|v6"], 4, 16);
    // The container is in front, so the top wall bulges into the inner room.
    const ys = Object.values(curved.vertices).map((point) => point.y);
    expect(ys).toContain(80);
    expect(ys).not.toContain(48);
  });

  it("bends it into the room with a negative distance", () => {
    const curved = curveWalls(hall.map, ["v1|v2"], 4, -32);
    const ys = Object.values(curved.vertices).map((p) => p.y);
    expect(Math.min(...ys)).toBe(0);
    expect(ys).toContain(32);
  });
});

describe("flipping walls", () => {
  const pair = drawRoom(hall.map, box(512, 0, 768, 256), {}, 1);
  const shared = defined(
    [...wallOwners(pair.map)].find(([, owners]) => owners.length === 2),
  )[0];

  it("turns a wall between two rooms round", () => {
    const before = describeLine(pair.map, shared, hall.id).front.id;
    const flipped = flipWalls(pair.map, [shared]);
    expect(describeLine(flipped, shared, hall.id).front.id).not.toBe(before);
    // A wall with nothing behind it stays as it is.
    expect(flipWalls(hall.map, ["v1|v2"])).toBe(hall.map);
  });

  it("swaps what its two sides show", () => {
    const brown = updateSector(pair.map, pair.id, { wallTexture: "BROWN1" });
    const painted = updateLineSide(brown, shared, hall.id, { lower: "METAL" });
    const swapped = swapWallSides(painted, [shared]);
    const [hallRoom, other] = [hall.id, pair.id].map((id) =>
      defined(swapped.sectors.find((sector) => sector.id === id)),
    );
    expect(wallPartTexture(swapped, other, shared, "lower")).toBe("METAL");
    expect(wallPartTexture(swapped, hallRoom, shared, "lower")).toBe("BROWN1");
    expect(swapWallSides(pair.map, [shared])).toBe(pair.map);
  });
});

describe("building stairs", () => {
  it("steps a run of rooms from its end", () => {
    let map = empty;
    for (const left of [0, 128, 256]) {
      map = drawRoom(map, box(left, 0, left + 128, 128), {}, 1).map;
    }
    const ids = map.sectors.map((sector) => sector.id).toReversed();
    const stairs = defined(stairRooms(map, ids, 16, true));
    const floors = [64, 192, 320].map(
      (x) => defined(sectorAt(stairs, { x, y: 64 })).floor,
    );
    expect(floors.toSorted((a, b) => a - b)).toEqual([0, 16, 32]);
    expect(Math.abs(floors[0] - floors[2])).toBe(32);
  });

  it("keeps each room's headroom and refuses a branching run", () => {
    let map = empty;
    for (const [left, top] of [
      [0, 0],
      [128, 0],
      [256, 0],
      [128, 128],
    ]) {
      map = drawRoom(map, box(left, top, left + 128, top + 128), {}, 1).map;
    }
    const ids = map.sectors.map((sector) => sector.id);
    expect(stairRooms(map, ids, 16, true)).toBeNull();
    const tall = updateSector(map, ids[2], { ceiling: 300 });
    const run = defined(stairRooms(tall, ids.slice(0, 3), 16, true));
    const third = defined(run.sectors.find((sector) => sector.id === ids[2]));
    expect(third.ceiling - third.floor).toBe(300);
  });

  it("cuts a corridor into steps across its length", () => {
    const steps = defined(splitIntoSteps(hall.map, hall.id, 4, 8, false));
    expect(steps.rooms).toHaveLength(4);
    const floors = [64, 192, 320, 448].map(
      (x) => defined(sectorAt(steps.map, { x, y: 128 })).floor,
    );
    expect(floors).toEqual([0, 8, 16, 24]);
    expect(problems(steps.map)).toEqual([]);
  });

  it("leaves a room beside the corridor alone", () => {
    const side = drawRoom(hall.map, box(128, 256, 384, 384), {}, 1);
    const steps = defined(splitIntoSteps(side.map, hall.id, 4, 8, false));
    expect(sectorAt(steps.map, { x: 256, y: 320 })?.id).toBe(side.id);
    expect(steps.map.sectors).toHaveLength(5);
  });
});

function problems(map: GameMap) {
  return validateMap(map)
    .map((issue) => issue.id.split(":")[0])
    .filter((id) => !["no-player", "no-exit"].includes(id));
}

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}
