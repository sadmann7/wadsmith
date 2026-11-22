import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import type { GameMap, Point } from "./types";

import { addRoom, addSwitch, updateLine } from "./edit";
import { wallKey, wallOwners } from "./geometry";
import { joinWalls } from "./join";
import { validateMap } from "./validate";

const empty: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

const hall = addRoom(empty, box(0, 0, 512, 128), {}, 1);

describe("joining a drawn room to the walls it meets", () => {
  it("gives a long wall the corners of a room drawn against its middle", () => {
    // Its top wall runs along part of the hall's bottom wall.
    const side = drawn(hall.map, box(128, 128, 256, 256));
    expect(sharedWalls(side.map)).toHaveLength(1);
    expect(defined(side.map.sectors[0]).vertices).toHaveLength(6);
    expect(
      validateMap(side.map).filter((issue) => issue.id !== "no-player"),
    ).toEqual([]);
    // Without the join the two walls only run along each other.
    const loose = addRoom(hall.map, box(128, 128, 256, 256), {}, 1).map;
    expect(sharedWalls(loose)).toHaveLength(0);
  });

  it("gives a new wall the corners already lying on it", () => {
    const small = addRoom(empty, box(128, 0, 256, 128), {}, 1);
    // The new room's top wall is longer than the small room's bottom wall.
    const wide = drawn(small.map, box(0, 128, 512, 256));
    expect(sharedWalls(wide.map)).toHaveLength(1);
    expect(defined(wide.map.sectors[1]).vertices).toHaveLength(6);
    expect(Object.keys(wide.map.vertices)).toHaveLength(8);
  });

  it("puts one corner where two walls cross and gives it to both", () => {
    const tall = drawn(hall.map, box(192, -64, 320, 192));
    const spots = Object.values(tall.map.vertices).map(
      (point) => `${point.x},${point.y}`,
    );
    for (const spot of ["192,0", "320,0", "192,128", "320,128"]) {
      expect(spots.filter((item) => item === spot)).toHaveLength(1);
    }
    const [first, second] = tall.map.sectors;
    const both = first.vertices.filter((id) => second.vertices.includes(id));
    expect(both).toHaveLength(4);
  });

  it("keeps a split wall's settings on both halves", () => {
    const bottom = wallKey("v3", "v4");
    const marked = updateLine(hall.map, bottom, { secret: true });
    const side = drawn(marked, box(128, 128, 256, 256));
    const halves = Object.entries(side.map.lines ?? {}).filter(
      ([, line]) => line.secret,
    );
    expect(halves).toHaveLength(3);
    expect(side.map.lines?.[bottom]).toBeUndefined();
  });

  it("leaves a wall with a switch whole and a far room alone", () => {
    const switched = defined(
      addSwitch(
        hall.map,
        { sector: hall.id, from: "v3", to: "v4" },
        { x: 400, y: 128 },
        null,
        1,
      ),
    ).map;
    const walls = [...wallOwners(switched).keys()].toSorted();
    const far = drawn(switched, box(1024, 1024, 1152, 1152));
    expect(
      [...wallOwners(far.map).keys()]
        .filter((key) => walls.includes(key))
        .toSorted(),
    ).toEqual(walls);
    const side = drawn(switched, box(380, 128, 420, 256));
    expect(side.map.switches).toEqual(switched.switches);
    expect(
      defined(side.map.switches[0]).from in side.map.vertices &&
        defined(side.map.switches[0]).to in side.map.vertices,
    ).toBe(true);
  });
});

function drawn(map: GameMap, corners: Point[]) {
  const room = addRoom(map, corners, {}, 1);
  return { id: room.id, map: joinWalls(room.map, [room.id]) };
}

// The walls two different rooms share.
function sharedWalls(map: GameMap) {
  return [...wallOwners(map)]
    .filter(([, owners]) => owners.length === 2 && owners[0] !== owners[1])
    .map(([key]) => key);
}

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}
