import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import type { Transform } from "./fragment";
import type { GameMap, LineAction } from "./types";

import {
  addDetail,
  addRoom,
  setLineTarget,
  updateLine,
  updateSector,
} from "./edit";
import {
  copyParts,
  parseFragment,
  partKeys,
  pasteParts,
  pickedRooms,
  removeParts,
  selectedParts,
  serializeFragment,
  transformParts,
} from "./fragment";
import { wallKey, wallOwners } from "./geometry";
import { starterMap } from "./starter-map";
import { islandMap, testMap } from "./test-map";
import { newProblems, validateMap } from "./validate";

const openWall = wallKey("v3", "v4");
const lowerFloor: LineAction = {
  kind: "floor-lower",
  trigger: "walk",
  repeat: false,
  tag: 0,
};
const empty: GameMap = { vertices: {}, sectors: [], things: [], switches: [] };

// One square room with a thing in its middle and a line drawn across it.
const square = (() => {
  const room = addRoom(empty, [
    { x: 0, y: 0 },
    { x: 128, y: 0 },
    { x: 128, y: 128 },
    { x: 0, y: 128 },
  ]);
  const lined = defined(
    addDetail(room.map, [
      { x: 32, y: 32 },
      { x: 32, y: 96 },
    ]),
  ).map;
  return {
    ...lined,
    things: [{ id: "imp-1", kind: "imp" as const, x: 96, y: 64, angle: 0 }],
  };
})();

describe("what a selection covers", () => {
  it("takes the active room with the things standing in it", () => {
    expect(selectedParts(testMap, [], "sector-3")).toEqual({
      sectors: ["sector-3"],
      things: ["zombieman-1", "imp-1"],
    });
    expect(selectedParts(testMap, ["thing:shotgun-1"], null)).toEqual({
      sectors: [],
      things: ["shotgun-1"],
    });
  });

  it("takes a room once every corner of its outline is selected", () => {
    const corners = ["v3", "v13", "v14", "v4"];
    expect(selectedParts(testMap, corners.slice(1), null).sectors).toEqual([]);
    expect(selectedParts(testMap, corners, null)).toEqual({
      sectors: ["sector-2"],
      things: ["shotgun-1"],
    });
  });

  it("takes the rooms drawn inside a room along with it", () => {
    const [yard, stage] = islandMap.sectors;
    const parts = selectedParts(islandMap, [], yard.id);
    expect(parts.sectors).toEqual([yard.id, stage.id]);
    // The room picked is the yard alone, which is what the inspector edits.
    expect(pickedRooms(islandMap, [], yard.id)).toEqual([yard.id]);
    expect(
      pickedRooms(islandMap, [...yard.vertices, ...stage.vertices], null),
    ).toEqual([yard.id, stage.id]);
    expect(partKeys(islandMap, parts)).toEqual(
      expect.arrayContaining([...yard.vertices, ...stage.vertices]),
    );
  });
});

describe("copy and paste", () => {
  it("pastes a room and its things under new ids at the pointer", () => {
    const fragment = defined(
      copyParts(testMap, selectedParts(testMap, [], "sector-3")),
    );
    expect(fragment.sectors).toHaveLength(1);
    expect(Object.keys(fragment.vertices)).toHaveLength(6);
    const pasted = defined(
      pasteParts(testMap, fragment, { x: 2000, y: 2000 }, 32),
    );
    expect(pasted.sectors).toEqual(["sector-5"]);
    const room = defined(pasted.map.sectors.at(-1));
    expect(room.name).toBe("Arena copy");
    expect(room.vertices.every((id) => !(id in testMap.vertices))).toBe(true);
    expect(pasted.map.things.slice(-2).map((thing) => thing.id)).toEqual([
      "zombieman-2",
      "imp-2",
    ]);
    // The piece moves as one, by a whole number of grid steps.
    const from = testMap.vertices[testMap.sectors[2].vertices[0]];
    const to = pasted.map.vertices[room.vertices[0]];
    const shift = { x: to.x - from.x, y: to.y - from.y };
    expect([shift.x % 32, shift.y % 32]).toEqual([0, 0]);
    expect(pasted.map.things.at(-1)).toMatchObject({
      x: 832 + shift.x,
      y: 64 + shift.y,
    });
    expect(pasted.keys.toSorted()).toEqual(
      [...room.vertices, "thing:zombieman-2", "thing:imp-2"].toSorted(),
    );
    expect(pasted.map.sectors.slice(0, 4)).toEqual(testMap.sectors);
    expect(validateMap(pasted.map)).toEqual([]);
  });

  it("leaves a player start behind and pastes none", () => {
    const parts = selectedParts(testMap, [], "sector-1");
    expect(parts.things).toContain("player-1");
    const fragment = defined(copyParts(testMap, parts));
    expect(fragment.things).toEqual([]);
    const crafted = { ...fragment, things: [testMap.things[0]] };
    const pasted = defined(pasteParts(testMap, crafted, { x: 0, y: 2000 }, 32));
    expect(
      pasted.map.things.filter((thing) => thing.kind === "player"),
    ).toHaveLength(1);
  });

  it("keeps a switch wired to its door only when the door comes too", () => {
    const both = defined(
      copyParts(testMap, {
        sectors: ["sector-1", "sector-4"],
        things: [],
      }),
    );
    expect(both.switches[0].door).toBe("sector-4");
    const pasted = defined(pasteParts(testMap, both, { x: 0, y: 3000 }, 32));
    const copy = defined(pasted.map.switches.at(-1));
    expect(copy.id).toBe("switch-2");
    expect(pasted.sectors).toContain(copy.sector);
    expect(pasted.sectors).toContain(copy.door);
    expect(copy.door).not.toBe("sector-4");
    const alone = defined(
      copyParts(testMap, { sectors: ["sector-1"], things: [] }),
    );
    expect(alone.switches[0].door).toBeNull();
  });

  it("gives a copied line and its room a tag of their own", () => {
    const wired = setLineTarget(
      updateLine(testMap, openWall, { action: lowerFloor }),
      openWall,
      "sector-3",
    );
    const tag = defined(wired.sectors[2].tag);
    const pair = defined(
      copyParts(wired, {
        sectors: ["sector-1", "sector-2", "sector-3"],
        things: [],
      }),
    );
    const pasted = defined(pasteParts(wired, pair, { x: 0, y: 3000 }, 32)).map;
    const room = defined(pasted.sectors.at(-1));
    expect(room.tag).not.toBe(tag);
    const actions = Object.values(pasted.lines ?? {}).flatMap(
      (line) => line.action ?? [],
    );
    const byNumber = (a: number, b: number) => a - b;
    expect(actions.map((action) => action.tag).toSorted(byNumber)).toEqual(
      [tag, defined(room.tag)].toSorted(byNumber),
    );
  });

  it("keeps a tag whose other end stays behind only in its own map", () => {
    const wired = setLineTarget(
      updateLine(testMap, openWall, { action: lowerFloor }),
      openWall,
      "sector-3",
    );
    const tag = defined(wired.sectors[2].tag);
    const at = { x: 0, y: 3000 };
    // The room without its line: in its own map it keeps moving with the
    // rooms it moved with, and in another map the tag would be a stranger's.
    const room = defined(
      copyParts(wired, { sectors: ["sector-3"], things: [] }),
    );
    const home = defined(pasteParts(wired, room, at, 32, true)).map;
    expect(home.sectors.at(-1)?.tag).toBe(tag);
    expect(validateMap(home)).toEqual([]);
    const away = defined(pasteParts(wired, room, at, 32)).map;
    expect(away.sectors.at(-1)?.tag).toBeUndefined();
    // The line without its room: in another map it asks for a new target.
    const line = defined(
      copyParts(wired, { sectors: ["sector-1", "sector-2"], things: [] }),
    );
    const tagsOf = (map: GameMap) =>
      Object.values(map.lines ?? {}).flatMap((item) => item.action?.tag ?? []);
    expect(tagsOf(defined(pasteParts(wired, line, at, 32, true)).map)).toEqual([
      tag,
      tag,
    ]);
    const stray = defined(pasteParts(wired, line, at, 32)).map;
    expect(tagsOf(stray)).toEqual([tag, 0]);
    // The start room's switch came without its door, so it asks for one too.
    expect(validateMap(stray).map((issue) => issue.id.split(":")[0])).toEqual([
      "switch-unwired",
      "line-target",
    ]);
  });

  it("drops a raw special whose tagged room stays behind in another map", () => {
    const fake = updateSector(
      updateLine(testMap, openWall, { raw: { special: 242, tag: 7 } }),
      "sector-3",
      { tag: 7 },
    );
    const piece = defined(
      copyParts(fake, { sectors: ["sector-1", "sector-2"], things: [] }),
    );
    const at = { x: 0, y: 3000 };
    const raws = (map: GameMap) =>
      Object.values(map.lines ?? {}).flatMap((line) => line.raw ?? []);
    // With no tag it would act on every room that has none.
    expect(raws(defined(pasteParts(fake, piece, at, 32)).map)).toEqual([
      { special: 242, tag: 7 },
    ]);
    expect(raws(defined(pasteParts(fake, piece, at, 32, true)).map)).toEqual([
      { special: 242, tag: 7 },
      { special: 242, tag: 7 },
    ]);
  });

  it("leaves out whatever a piece says about corners that aren't its own", () => {
    const fragment = defined(
      copyParts(testMap, { sectors: ["sector-3"], things: [] }),
    );
    const crafted: GameMap = {
      ...fragment,
      lines: {
        [openWall]: {
          action: { kind: "exit", trigger: "walk", repeat: false, tag: 0 },
          sides: { "sector-1": { offsetX: 8 } },
        },
      },
      switches: [{ ...testMap.switches[0] }],
    };
    const pasted = defined(pasteParts(testMap, crafted, { x: 0, y: 3000 }, 32));
    expect(pasted.map.lines).toBeUndefined();
    expect(pasted.map.switches).toEqual(testMap.switches);
  });

  it("drops the action of a wall that led to a room left behind", () => {
    const wired = setLineTarget(
      updateLine(testMap, openWall, { action: lowerFloor }),
      openWall,
      "sector-3",
    );
    const corridor = defined(
      copyParts(wired, { sectors: ["sector-2"], things: [] }),
    );
    expect(corridor.lines).toBeUndefined();
    const pasted = defined(pasteParts(wired, corridor, { x: 0, y: 3000 }, 32));
    expect(validateMap(pasted.map)).toEqual([]);
  });

  it("steps a copy made in place aside until it touches nothing", () => {
    const small = addRoom(empty, [
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 32, y: 32 },
      { x: 0, y: 32 },
    ]);
    const fragment = defined(
      copyParts(small.map, { sectors: [small.id], things: [] }),
    );
    // One step would put its first corner on the original's last.
    const pasted = defined(pasteParts(small.map, fragment, null, 8, true));
    expect(Object.keys(pasted.map.vertices)).toHaveLength(8);
    expect(pasted.keys).toHaveLength(4);
    expect(selectedParts(pasted.map, pasted.keys, null).sectors).toEqual(
      pasted.sectors,
    );
  });

  it("moves a piece aside when it would land on itself", () => {
    const fragment = defined(
      copyParts(testMap, { sectors: ["sector-3"], things: [] }),
    );
    const pasted = defined(pasteParts(testMap, fragment, null, 32));
    const room = defined(pasted.map.sectors.at(-1));
    expect(pasted.map.vertices[room.vertices[0]]).toEqual({
      x: testMap.vertices.v9.x + 64,
      y: testMap.vertices.v9.y + 64,
    });
  });

  it("joins a pasted room to the room it lands against", () => {
    const fragment = defined(
      copyParts(square, selectedParts(square, [], square.sectors[0].id)),
    );
    const pasted = defined(pasteParts(square, fragment, { x: 192, y: 64 }, 32));
    expect(pasted.map.sectors).toHaveLength(2);
    expect(Object.keys(pasted.map.vertices)).toHaveLength(10);
    const shared = [...wallOwners(pasted.map).values()].filter(
      (owners) => owners.length === 2 && owners[0] !== owners[1],
    );
    expect(shared).toHaveLength(1);
    // The corners it shares now are selected with it, so it is a whole room.
    expect(selectedParts(pasted.map, pasted.keys, null).sectors).toEqual(
      pasted.sectors,
    );
    expect(validateMap(pasted.map).map((issue) => issue.id)).toEqual([
      "no-player",
    ]);
  });

  it("cuts by taking the copied rooms and things out", () => {
    const parts = selectedParts(testMap, [], "sector-3");
    const cut = removeParts(testMap, parts);
    expect(cut.sectors.map((sector) => sector.id)).not.toContain("sector-3");
    expect(cut.things.map((thing) => thing.id)).toEqual([
      "player-1",
      "shotgun-1",
    ]);
  });

  it("reads a piece back from text and refuses anything else", () => {
    const fragment = defined(
      copyParts(testMap, selectedParts(testMap, [], "sector-3")),
    );
    expect(parseFragment(serializeFragment(fragment))).toEqual({
      fragment,
      origin: null,
    });
    expect(parseFragment(serializeFragment(fragment, "map-1"))?.origin).toBe(
      "map-1",
    );
    expect(parseFragment("hello")).toBeNull();
    expect(parseFragment('{"format":"wadsmith-fragment"}')).toBeNull();
    expect(
      parseFragment(
        '{"format":"wadsmith-fragment","version":1,"map":{"sectors":3}}',
      ),
    ).toBeNull();
  });
});

describe("turning, flipping and resizing", () => {
  const room = square.sectors[0];
  const keys = partKeys(square, selectedParts(square, [], room.id));
  const cornersOf = (map: GameMap) =>
    map.sectors[0].vertices.map((id) => map.vertices[id]);

  it("turns a room a quarter to the right with what stands in it", () => {
    const turned = defined(
      transformParts(square, keys, { kind: "rotate", degrees: 90 }, 32),
    );
    expect(cornersOf(turned)).toEqual([
      { x: 128, y: 0 },
      { x: 128, y: 128 },
      { x: 0, y: 128 },
      { x: 0, y: 0 },
    ]);
    // The thing was east of the middle facing east, and ends south facing south.
    expect(turned.things[0]).toMatchObject({ x: 64, y: 96, angle: 270 });
    const back = defined(
      transformParts(turned, keys, { kind: "rotate", degrees: -90 }, 32),
    );
    expect(back.vertices).toEqual(square.vertices);
    expect(back.things).toEqual(square.things);
  });

  it("flips a room and turns its inner line to keep the line's face", () => {
    const flipped = defined(
      transformParts(square, keys, { kind: "mirror", axis: "horizontal" }, 32),
    );
    expect(flipped.things[0]).toMatchObject({ x: 32, y: 64, angle: 180 });
    const [from, to] = defined(room.details)[0];
    expect(defined(flipped.sectors[0].details)[0]).toEqual([to, from]);
    expect(flipped.vertices[from]).toEqual({ x: 96, y: 32 });
    const upsideDown = defined(
      transformParts(square, keys, { kind: "mirror", axis: "vertical" }, 32),
    );
    expect(upsideDown.things[0]).toMatchObject({ x: 96, y: 64, angle: 0 });
    expect(upsideDown.vertices[from]).toEqual({ x: 32, y: 96 });
  });

  it("resizes a room on the grid and refuses to flatten it", () => {
    const doubled = defined(
      transformParts(square, keys, { kind: "scale", factor: 2 }, 32),
    );
    expect(cornersOf(doubled)).toEqual([
      { x: -64, y: -64 },
      { x: 192, y: -64 },
      { x: 192, y: 192 },
      { x: -64, y: 192 },
    ]);
    expect(doubled.things[0]).toMatchObject({ x: 128, y: 64, angle: 0 });
    expect(
      transformParts(square, keys, { kind: "scale", factor: 0.01 }, 32),
    ).toBeNull();
    expect(
      transformParts(square, keys, { kind: "scale", factor: 1 }, 32),
    ).toBeNull();
    expect(
      transformParts(square, [], { kind: "rotate", degrees: 90 }, 32),
    ).toBeNull();
  });

  it("comes back after four quarter turns, on the grid all the way", () => {
    // A room twice as wide as tall has no grid point at its middle.
    const wide = addRoom(empty, [
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 64, y: 32 },
      { x: 0, y: 32 },
    ]);
    const corners = wide.map.sectors[0].vertices;
    let turned = wide.map;
    for (let turn = 0; turn < 4; turn += 1) {
      turned = defined(
        transformParts(turned, corners, { kind: "rotate", degrees: 90 }, 32),
      );
      for (const point of Object.values(turned.vertices)) {
        expect([Math.abs(point.x % 32), Math.abs(point.y % 32)]).toEqual([
          0, 0,
        ]);
      }
    }
    expect(turned.vertices).toEqual(wide.map.vertices);
  });

  it("turns a square that sits off the grid in place", () => {
    const square48 = addRoom(
      empty,
      [
        { x: 16, y: 0 },
        { x: 64, y: 0 },
        { x: 64, y: 48 },
        { x: 16, y: 48 },
      ],
      {},
      1,
    );
    const corners = square48.map.sectors[0].vertices;
    const spots = (map: GameMap) =>
      Object.values(map.vertices)
        .map((point) => `${point.x},${point.y}`)
        .toSorted();
    let turned = square48.map;
    for (let turn = 0; turn < 4; turn += 1) {
      turned = defined(
        transformParts(turned, corners, { kind: "rotate", degrees: 90 }, 32),
      );
      expect(spots(turned)).toEqual(spots(square48.map));
    }
    expect(turned.vertices).toEqual(square48.map.vertices);
    const back = defined(
      transformParts(
        defined(
          transformParts(
            square48.map,
            corners,
            { kind: "rotate", degrees: 90 },
            32,
          ),
        ),
        corners,
        { kind: "rotate", degrees: -90 },
        32,
      ),
    );
    expect(back.vertices).toEqual(square48.map.vertices);
  });

  it("keeps a room on the grid when a thing beside it squares the selection", () => {
    const room = addRoom(
      empty,
      [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
        { x: 64, y: 64 },
        { x: 0, y: 64 },
      ],
      {},
      64,
    );
    const map: GameMap = {
      ...room.map,
      things: [{ id: "imp-1", kind: "imp", x: 96, y: 96, angle: 0 }],
    };
    const turned = defined(
      transformParts(
        map,
        [...room.map.sectors[0].vertices, "thing:imp-1"],
        { kind: "rotate", degrees: 90 },
        64,
      ),
    );
    for (const point of Object.values(turned.vertices)) {
      expect([Math.abs(point.x % 64), Math.abs(point.y % 64)]).toEqual([0, 0]);
    }
  });

  it("flips a room where it stands and turns a lone thing on the spot", () => {
    const odd = addRoom(
      empty,
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 24 },
        { x: 0, y: 24 },
      ],
      {},
      8,
    );
    const flipped = defined(
      transformParts(
        {
          ...odd.map,
          things: [{ id: "imp-1", kind: "imp", x: 8, y: 8, angle: 0 }],
        },
        [...odd.map.sectors[0].vertices, "thing:imp-1"],
        { kind: "mirror", axis: "horizontal" },
        8,
      ),
    );
    expect(
      Object.values(flipped.vertices)
        .map((point) => point.x)
        .toSorted((a, b) => a - b),
    ).toEqual([0, 0, 40, 40]);
    expect(flipped.things[0]).toMatchObject({ x: 32, y: 8, angle: 180 });
    const lone: GameMap = {
      ...empty,
      things: [{ id: "imp-1", kind: "imp", x: 100, y: 100, angle: 0 }],
    };
    expect(
      defined(
        transformParts(
          lone,
          ["thing:imp-1"],
          { kind: "rotate", degrees: 90 },
          32,
        ),
      ).things[0],
    ).toMatchObject({ x: 100, y: 100, angle: 270 });
  });

  it("turns by any angle onto the grid", () => {
    const turned = defined(
      transformParts(square, keys, { kind: "rotate", degrees: 45 }, 8),
    );
    for (const point of Object.values(turned.vertices)) {
      expect([Math.abs(point.x % 8), Math.abs(point.y % 8)]).toEqual([0, 0]);
    }
    expect(turned.things[0].angle).toBe(315);
  });

  it("finds the doors a turn or flip of a joined room would break", () => {
    const arena = defined(
      starterMap.sectors.find((sector) => sector.name === "Arena"),
    );
    const arenaKeys = partKeys(
      starterMap,
      selectedParts(starterMap, [], arena.id),
    );
    const steps: Transform[] = [
      { kind: "rotate", degrees: 90 },
      { kind: "rotate", degrees: -90 },
      { kind: "mirror", axis: "vertical" },
    ];
    for (const step of steps) {
      const turned = defined(transformParts(starterMap, arenaKeys, step, 32));
      const broken = newProblems(starterMap, turned).map(
        (issue) => issue.target,
      );
      for (const door of ["Arena door", "Blue door"]) {
        const room = defined(
          starterMap.sectors.find((sector) => sector.name === door),
        );
        expect(broken).toContain(room.id);
      }
    }
  });

  it("names the door a turn breaks, not a room that was already broken", () => {
    const arena = defined(
      starterMap.sectors.find((sector) => sector.name === "Arena"),
    );
    const broken = addRoom(starterMap, [
      { x: 2048, y: 0 },
      { x: 2112, y: 0 },
      { x: 2176, y: 0 },
    ]);
    const turned = defined(
      transformParts(
        broken.map,
        partKeys(broken.map, selectedParts(broken.map, [], arena.id)),
        { kind: "rotate", degrees: 90 },
        32,
      ),
    );
    const named = newProblems(broken.map, turned).map((issue) => issue.target);
    const doors = starterMap.sectors
      .filter(
        (sector) => sector.name === "Arena door" || sector.name === "Blue door",
      )
      .map((sector) => sector.id);
    expect(named).toEqual(expect.arrayContaining(doors));
    expect(named).not.toContain(broken.id);
  });

  it("finds nothing new when a room joined to no other turns", () => {
    const turned = defined(
      transformParts(square, keys, { kind: "rotate", degrees: 90 }, 32),
    );
    expect(newProblems(square, turned)).toEqual([]);
  });
});
