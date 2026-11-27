import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import type { GameMap, Point } from "./types";

import { checkMap } from "./checks";
import { dropRooms, getDoOverlap, planRoomDrop } from "./drop";
import {
  addRoom,
  addThing,
  applyPositions,
  makePillar,
  positionsOf,
} from "./edit";
import { partKeys, selectedParts } from "./fragment";
import { wallOwners } from "./geometry";

const empty: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

describe("dropping a dragged room", () => {
  it("snaps a room dropped near a wall flush against it", () => {
    const { map, room } = twoRooms();
    const keys = roomKeys(map, room);
    // Dragged 56 left, its left wall stops 8 short of the hall's right wall.
    const drop = defined(planRoomDrop(map, keys, { x: -56, y: 0 }, 14));
    expect(drop.offset).toEqual({ x: -64, y: 0 });
    expect(drop.isBlocked).toBe(false);
    expect(drop.walls).toHaveLength(1);
    const hallRight = [...wallOwners(map)].find(([key]) => {
      const [a, b] = key.split("|").map((id) => map.vertices[id]);
      return a.x === 256 && b.x === 256;
    });
    expect(drop.walls).toEqual([defined(hallRight)[0]]);
  });

  it("leaves a room alone when no wall is within reach", () => {
    const { map, room } = twoRooms();
    const drop = defined(
      planRoomDrop(map, roomKeys(map, room), { x: -32, y: 0 }, 14),
    );
    expect(drop).toEqual({
      offset: { x: -32, y: 0 },
      walls: [],
      isBlocked: false,
    });
  });

  it("joins the dropped room to the hall, which clears the loose room warning", () => {
    const { map, room } = twoRooms();
    expect(looseWarnings(map)).not.toEqual([]);
    const keys = roomKeys(map, room);
    const drop = defined(planRoomDrop(map, keys, { x: -60, y: 0 }, 14));
    const landed = land(map, keys, drop.offset);
    expect(sharedWalls(landed.map)).toHaveLength(1);
    expect(looseWarnings(landed.map)).toEqual([]);
  });

  it("blocks a drop that would overlap another room", () => {
    const { map, room } = twoRooms();
    const drop = defined(
      planRoomDrop(map, roomKeys(map, room), { x: -128, y: 0 }, 14),
    );
    expect(drop.isBlocked).toBe(true);
  });

  it("doesn't snap into a spot that would overlap", () => {
    const { map, room } = twoRooms();
    // Its right wall is 8 past the hall's right wall, inside the hall.
    const drop = defined(
      planRoomDrop(map, roomKeys(map, room), { x: -184, y: 0 }, 14),
    );
    expect(drop.isBlocked).toBe(true);
  });

  it("lets a room move about inside the room around it", () => {
    const hall = addRoom(empty, box(0, 0, 512, 512), {}, 1);
    const inner = addRoom(hall.map, box(128, 128, 192, 192), {}, 1);
    const keys = roomKeys(inner.map, inner.id);
    const inside = defined(planRoomDrop(inner.map, keys, { x: 64, y: 64 }, 14));
    expect(inside.isBlocked).toBe(false);
    const across = defined(planRoomDrop(inner.map, keys, { x: 352, y: 0 }, 14));
    expect(across.isBlocked).toBe(true);
  });

  it("gives nothing to plan for corners that make no whole room", () => {
    const { map, room } = twoRooms();
    const [corner] = roomKeys(map, room);
    expect(planRoomDrop(map, [defined(corner)], { x: 8, y: 0 }, 14)).toBeNull();
  });
});

function looseWarnings(map: GameMap) {
  return checkMap(map).filter((issue) => issue.id.startsWith("unreachable"));
}

describe("dropping a room among others", () => {
  it("blocks dragging a joined room through the room it's joined to", () => {
    const { map, room } = twoRooms();
    const keys = roomKeys(map, room);
    const joined = land(map, keys, { x: -64, y: 0 }).map;
    const again = roomKeys(joined, room);
    expect(
      defined(planRoomDrop(joined, again, { x: -320, y: 0 }, 14)).isBlocked,
    ).toBe(true);
    expect(
      defined(planRoomDrop(joined, again, { x: 0, y: 32 }, 14)).isBlocked,
    ).toBe(false);
  });

  it("moves a room joined to the inside wall of the room around it", () => {
    const hall = addRoom(empty, box(0, 0, 512, 512), {}, 1);
    const inner = addRoom(hall.map, box(8, 128, 72, 192), {}, 1);
    const keys = roomKeys(inner.map, inner.id);
    const drop = defined(planRoomDrop(inner.map, keys, { x: -6, y: 0 }, 14));
    expect(drop.offset).toEqual({ x: -8, y: 0 });
    const joined = land(inner.map, keys, drop.offset).map;
    const again = roomKeys(joined, inner.id);
    for (const offset of [
      { x: 0, y: 32 },
      { x: 64, y: 0 },
      { x: 64, y: 64 },
    ]) {
      expect(defined(planRoomDrop(joined, again, offset, 14)).isBlocked).toBe(
        false,
      );
    }
    expect(
      defined(planRoomDrop(joined, again, { x: 520, y: 0 }, 14)).isBlocked,
    ).toBe(true);
  });

  it("blocks a room moved over a pillar in the room around it", () => {
    const hall = addRoom(empty, box(0, 0, 512, 512), {}, 1);
    const post = addRoom(hall.map, box(256, 256, 320, 320), {}, 1);
    const pillared = defined(makePillar(post.map, post.id));
    const inner = addRoom(pillared, box(64, 64, 128, 128), {}, 1);
    const keys = roomKeys(inner.map, inner.id);
    expect(
      defined(planRoomDrop(inner.map, keys, { x: 224, y: 224 }, 14)).isBlocked,
    ).toBe(true);
    expect(
      defined(planRoomDrop(inner.map, keys, { x: 64, y: 0 }, 14)).isBlocked,
    ).toBe(false);
  });
});

describe("copying a dragged room", () => {
  it("leaves the room where it was and lands a joined copy", () => {
    const { map, room } = twoRooms();
    const withThing = addThing(map, "stimpack", { x: 384, y: 128 }).map;
    const keys = roomKeys(withThing, room);
    const drop = defined(
      planRoomDrop(withThing, keys, { x: 0, y: 136 }, 14, true),
    );
    // The copy snaps under the room it was copied from.
    expect(drop.offset).toEqual({ x: 0, y: 128 });
    expect(drop.isBlocked).toBe(false);
    const landed = land(withThing, keys, drop.offset, true);
    expect(landed.map.sectors).toHaveLength(3);
    expect(
      landed.map.things.filter((thing) => thing.kind === "stimpack"),
    ).toHaveLength(2);
    expect(
      defined(landed.map.sectors.find((sector) => sector.id === room)).vertices,
    ).toEqual(
      defined(withThing.sectors.find((sector) => sector.id === room)).vertices,
    );
    expect(sharedWalls(landed.map)).toHaveLength(1);
  });

  it("copies a room about inside the room around it", () => {
    const hall = addRoom(empty, box(0, 0, 512, 512), {}, 1);
    const inner = addRoom(hall.map, box(128, 128, 192, 192), {}, 1);
    const keys = roomKeys(inner.map, inner.id);
    const drop = defined(
      planRoomDrop(inner.map, keys, { x: 128, y: 128 }, 14, true),
    );
    expect(drop.isBlocked).toBe(false);
    expect(land(inner.map, keys, drop.offset, true).map.sectors).toHaveLength(
      3,
    );
  });

  it("blocks a copy dropped over the room it copies", () => {
    const { map, room } = twoRooms();
    const drop = defined(
      planRoomDrop(map, roomKeys(map, room), { x: 32, y: 0 }, 14, true),
    );
    expect(drop.isBlocked).toBe(true);
  });
});

// A hall with the player in it, and a loose room to its right.
function twoRooms() {
  const hall = addRoom(empty, box(0, 0, 256, 256), {}, 1);
  const started = addThing(hall.map, "player", { x: 128, y: 128 }).map;
  const loose = addRoom(started, box(320, 64, 448, 192), {}, 1);
  return { map: loose.map, hall: hall.id, room: loose.id };
}

function roomKeys(map: GameMap, id: string) {
  return partKeys(map, selectedParts(map, [], id));
}

function land(map: GameMap, keys: string[], offset: Point, copy = false) {
  const positions = positionsOf(map);
  const moved = applyPositions(
    map,
    Object.fromEntries(
      keys.map((key) => [
        key,
        { x: positions[key].x + offset.x, y: positions[key].y + offset.y },
      ]),
    ),
  );
  return defined(dropRooms(map, moved, keys, { copy }));
}

function sharedWalls(map: GameMap) {
  return [...wallOwners(map)]
    .filter(([, owners]) => owners.length === 2 && owners[0] !== owners[1])
    .map(([key]) => key);
}

describe("rooms overlapping", () => {
  it("counts floors that overlap and not walls or corners that touch", () => {
    const a = box(0, 0, 128, 128);
    expect(getDoOverlap(a, box(64, 0, 192, 128))).toBe(true);
    expect(getDoOverlap(a, box(0, 0, 128, 128))).toBe(true);
    expect(getDoOverlap(a, box(32, 32, 64, 64))).toBe(true);
    expect(getDoOverlap(a, box(128, 0, 256, 128))).toBe(false);
    expect(getDoOverlap(a, box(128, 128, 256, 256))).toBe(false);
    expect(getDoOverlap(a, box(128, 64, 256, 96))).toBe(false);
  });
});

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}
