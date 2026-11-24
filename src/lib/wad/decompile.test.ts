import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { thingCatalog } from "@/lib/map/catalog";
import { sectorAt, wallKey } from "@/lib/map/geometry";
import { starterMap } from "@/lib/map/starter-map";
import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { islandMap, testMap } from "@/lib/map/test-map";
import { validateMap } from "@/lib/map/validate";

import { buildLevel, compileEpisode, compileMap } from "./compile";
import { decompileMap } from "./decompile";
import { WadFileError } from "./inspect";
import { type DoomMap, type DoomSector, readMaps } from "./read-map";

const freedoom = resolve(
  import.meta.dirname,
  "../../../public/engine/freedoom2.wad",
);

describe("decompileMap", () => {
  it("brings back the maps Wadsmith builds", () => {
    for (const source of [starterMap, testMap]) {
      const [doom] = readMaps([{ name: "map.wad", data: compileMap(source) }]);
      const { map, report } = decompileMap(doom);
      expect(validateMap(map)).toEqual([]);
      expect(map.sectors).toHaveLength(source.sectors.length);
      expect(map.sectors.filter((sector) => sector.door)).toHaveLength(
        source.sectors.filter((sector) => sector.door).length,
      );
      expect(kinds(map)).toEqual(kinds(source));
      expect(map.switches).toHaveLength(source.switches.length);
      expect(report.droppedThings).toEqual({});
      expect(report.droppedActions).toEqual({});
      expect(() => compileMap(map)).not.toThrow();
    }
  });

  it("keeps fast doors fast", () => {
    const fast: GameMap = {
      ...starterMap,
      sectors: starterMap.sectors.map((sector) =>
        sector.door
          ? { ...sector, door: { ...sector.door, fast: true } }
          : sector,
      ),
    };
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(fast) }]);
    const { map } = decompileMap(doom);
    const doors = map.sectors.filter((sector) => sector.door);
    expect(doors.length).toBeGreaterThan(1);
    expect(doors.every((sector) => sector.door?.fast)).toBe(true);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps a locked door's key on the door", () => {
    const lines = Object.fromEntries(
      Object.entries(starterMap.lines ?? {}).filter(
        ([wall]) => wall !== wallKey("v17", "v18"),
      ),
    );
    const locked: GameMap = {
      ...starterMap,
      lines,
      sectors: starterMap.sectors.map((sector) =>
        sector.door?.opensBy === "use"
          ? { ...sector, door: { ...sector.door, key: "red" } }
          : sector,
      ),
    };
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(locked) }]);
    const { map } = decompileMap(doom);
    const doors = map.sectors.filter(
      (sector) => sector.door?.opensBy === "use",
    );
    expect(doors.length).toBeGreaterThan(0);
    expect(doors.every((sector) => sector.door?.key === "red")).toBe(true);
    expect(
      Object.values(map.lines ?? {}).some((line) => line.action?.key),
    ).toBe(false);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps a fast locked door in a Boom map", () => {
    const lines = Object.fromEntries(
      Object.entries(starterMap.lines ?? {}).filter(
        ([wall]) => wall !== wallKey("v17", "v18"),
      ),
    );
    const locked: GameMap = {
      ...starterMap,
      complevel: "boom",
      lines,
      sectors: starterMap.sectors.map((sector) =>
        sector.door?.opensBy === "use"
          ? { ...sector, door: { ...sector.door, key: "red", fast: true } }
          : sector,
      ),
    };
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(locked) }]);
    const { map, report } = decompileMap(doom);
    expect(report.solidSectors).toBe(0);
    const doors = map.sectors.filter(
      (sector) => sector.door?.opensBy === "use",
    );
    expect(doors.map((sector) => sector.door)).toEqual([
      expect.objectContaining({ key: "red", fast: true, closes: true }),
    ]);
    expect(Object.values(map.lines ?? {}).some((line) => line.raw)).toBe(false);
  });

  it("keeps a pillar as a hole in its room", () => {
    const build = doomMap();
    const room = build.sector();
    box(build, room, [0, 0, 256, 256]);
    const pillar = [
      build.vertex(96, 96),
      build.vertex(160, 96),
      build.vertex(160, 160),
      build.vertex(96, 160),
    ];
    pillar.forEach((corner, index) =>
      build.line(corner, pillar[(index + 1) % 4], room),
    );
    build.map.things.push({ x: 32, y: 32, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.splitSectors).toBe(0);
    expect(map.sectors).toHaveLength(1);
    expect(map.sectors[0].holes).toHaveLength(1);
    expect(validateMap(map)).toEqual([]);
    expect(sectorAt(map, { x: 128, y: -128 })).toBeUndefined();
    expect(sectorAt(map, { x: 32, y: -32 })?.id).toBe("s0");
    expect(buildLevel(map).lines).toHaveLength(8);
    expect(() => compileMap(map)).not.toThrow();
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps a room inside another as a room with open shared walls", () => {
    const build = doomMap();
    const hall = build.sector();
    const island = build.sector({ floor: 32 });
    box(build, hall, [0, 0, 256, 256]);
    const inner = [
      build.vertex(96, 96),
      build.vertex(160, 96),
      build.vertex(160, 160),
      build.vertex(96, 160),
    ];
    inner.forEach((corner, index) =>
      build.line(corner, inner[(index + 1) % 4], hall, island, {
        special: 38,
        tag: 0,
      }),
    );
    build.map.things.push({ x: 32, y: 32, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.splitSectors).toBe(0);
    expect(map.sectors).toHaveLength(2);
    expect(map.sectors.every((sector) => !sector.holes)).toBe(true);
    expect(sectorAt(map, { x: 128, y: -128 })?.id).toBe("s1");
    expect(sectorAt(map, { x: 32, y: -32 })?.id).toBe("s0");
    const { lines } = buildLevel(map);
    expect(lines.filter((line) => line.backSector !== null)).toHaveLength(4);
    // A walk-over line on the shared wall is reachable from both rooms.
    expect(
      Object.values(map.lines ?? {}).filter(
        (line) => line.action?.kind === "floor-lower",
      ),
    ).toHaveLength(4);
  });

  it("keeps a line inside a room with its walk-over action", () => {
    const build = doomMap();
    const room = build.sector();
    const pit = build.sector({ floor: -32, tag: 5 });
    box(build, room, [0, 0, 512, 256]);
    const inner = [
      build.vertex(384, 96),
      build.vertex(448, 96),
      build.vertex(448, 160),
      build.vertex(384, 160),
    ];
    inner.forEach((corner, index) =>
      build.line(corner, inner[(index + 1) % 4], room, pit),
    );
    const a = build.vertex(128, 32);
    const b = build.vertex(128, 224);
    build.line(a, b, room, room, { special: 82, tag: 5, middle: "MIDGRATE" });
    build.map.things.push({ x: 32, y: 128, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.innerLines).toBe(0);
    expect(map.sectors).toHaveLength(2);
    expect(map.sectors[0].details).toEqual([["v8", "v9"]]);
    expect(map.lines?.[wallKey("v8", "v9")]).toMatchObject({
      action: { kind: "floor-lower", trigger: "walk", repeat: true, tag: 5 },
      sides: { s0: { middle: "MIDGRATE" } },
    });
    expect(validateMap(map)).toEqual([]);
    expect(() => compileMap(map)).not.toThrow();
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps walls with nothing behind them solid inside another room", () => {
    const build = doomMap();
    const hall = build.sector();
    const hut = build.sector({ floor: 16 });
    box(build, hall, [0, 0, 512, 512]);
    const [a, , , d] = box(build, hut, [192, 192, 320, 320]);
    build.map.things.push({ x: 32, y: 32, angle: 0, type: 1, flags: 7 });
    const sealed = decompileMap(build.map).map;
    expect(sealed.sectors).toHaveLength(2);
    expect(
      Object.values(sealed.lines ?? {}).filter((line) => line.solid),
    ).toHaveLength(4);
    expect(validateMap(sealed)).toEqual([]);
    expect(
      buildLevel(sealed).lines.every((line) => line.backSector === null),
    ).toBe(true);
    expect(parseMapFile(serializeMap(sealed))).toEqual(sealed);

    // An annex shares one wall with the hut; every other wall of both stays
    // solid towards the hall.
    const annex = build.sector({ floor: 16 });
    build.map.lines.pop();
    build.map.sides.pop();
    build.line(d, a, hut, annex);
    const e = build.vertex(320, 96);
    const f = build.vertex(192, 96);
    build.line(d, e, annex);
    build.line(e, f, annex);
    build.line(f, a, annex);
    const mixed = decompileMap(build.map).map;
    expect(mixed.sectors).toHaveLength(3);
    expect(
      Object.values(mixed.lines ?? {}).filter((line) => line.solid),
    ).toHaveLength(6);
    expect(validateMap(mixed)).toEqual([]);
    expect(
      buildLevel(mixed).lines.filter((line) => line.backSector !== null),
    ).toHaveLength(1);
  });

  it("turns a closed sector inside a room into a pillar", () => {
    const build = doomMap();
    const hall = build.sector();
    const block = build.sector({ ceiling: 0 });
    box(build, hall, [0, 0, 256, 256]);
    const inner = [
      build.vertex(96, 96),
      build.vertex(160, 96),
      build.vertex(160, 160),
      build.vertex(96, 160),
    ];
    inner.forEach((corner, index) =>
      build.line(corner, inner[(index + 1) % 4], hall, block),
    );
    build.map.things.push({ x: 32, y: 32, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.solidSectors).toBe(1);
    expect(map.sectors).toHaveLength(1);
    expect(map.sectors[0].holes).toHaveLength(1);
    expect(validateMap(map)).toEqual([]);
    expect(() => compileMap(map)).not.toThrow();
  });

  it("makes closed sectors solid unless an action opens them", () => {
    const build = doomMap();
    const hall = build.sector();
    const shut = build.sector({ ceiling: 0 });
    const pillar = build.sector({ ceiling: 0, floor: 0, tag: 7 });
    const [a, b, c, d] = box(build, hall, [0, 0, 512, 256]);
    build.map.lines.length = 0;
    build.map.sides.length = 0;
    const e = build.vertex(128, 0);
    const f = build.vertex(128, 64);
    const g = build.vertex(192, 64);
    const h = build.vertex(192, 0);
    const i = build.vertex(320, 0);
    const j = build.vertex(320, 64);
    const k = build.vertex(384, 64);
    const l = build.vertex(384, 0);
    build.line(a, b, hall);
    build.line(b, c, hall);
    build.line(c, d, hall);
    build.line(d, l, hall);
    build.line(l, k, hall, pillar);
    build.line(k, j, hall, pillar, { special: 23, tag: 7 });
    build.line(j, i, hall, pillar);
    build.line(l, i, pillar);
    build.line(i, h, hall);
    build.line(h, g, hall, shut);
    build.line(g, f, hall, shut);
    build.line(f, e, hall, shut);
    build.line(h, e, shut);
    build.line(e, a, hall);
    build.map.things.push({ x: 64, y: 128, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.solidSectors).toBe(1);
    expect(map.sectors.map((sector) => sector.id).toSorted()).toEqual([
      "s0",
      "s2",
    ]);
    expect(map.sectors.find((sector) => sector.id === "s2")).toMatchObject({
      floor: 0,
      ceiling: 0,
      tag: 7,
    });
    expect(validateMap(map)).toEqual([]);
    expect(() => compileMap(map)).not.toThrow();
  });

  it("keeps a switch on an open wall facing its first side", () => {
    const build = doomMap();
    const lift = build.sector({ tag: 4, floor: 64 });
    const hall = build.sector();
    const [a, b, c, d] = box(build, lift, [0, 0, 128, 128]);
    build.map.lines.length = 0;
    build.map.sides.length = 0;
    const e = build.vertex(256, 128);
    const f = build.vertex(256, 0);
    build.line(a, b, lift);
    build.line(b, c, lift);
    build.line(d, a, lift);
    build.line(d, c, hall, lift, { special: 62, tag: 4 });
    build.map.sides[defined(defined(build.map.lines.at(-1)).front)].lower =
      "SW1BRIK";
    build.line(c, e, hall);
    build.line(e, f, hall);
    build.line(f, d, hall);
    build.map.things.push({ x: 192, y: 64, angle: 0, type: 1, flags: 7 });

    const { map } = decompileMap(build.map);
    expect(map.sectors.map((sector) => sector.id)).toEqual(["s0", "s1"]);
    expect(
      Object.values(map.lines ?? {}).find((line) => line.action),
    ).toMatchObject({
      front: "s1",
    });
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    const line = defined(doom.lines.find((item) => item.special === 62));
    expect(doom.sectors[doom.sides[defined(line.front)].sector].tag).toBe(0);
    expect(doom.sides[defined(line.front)].lower).toMatch(/^SW1/);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps a door it can't hold open as a doorway", () => {
    const build = doomMap();
    const rooms = [
      build.sector(),
      build.sector({ ceiling: 0 }),
      build.sector({ ceiling: 0 }),
      build.sector(),
    ];
    const xs = [0, 256, 288, 320, 576];
    const top = xs.map((x) => build.vertex(x, 128));
    const bottom = xs.map((x) => build.vertex(x, 0));
    build.line(bottom[0], top[0], rooms[0]);
    build.line(top[4], bottom[4], rooms[3]);
    rooms.forEach((room, index) => {
      build.line(top[index], top[index + 1], room);
      build.line(bottom[index + 1], bottom[index], room);
    });
    build.line(top[1], bottom[1], rooms[0], rooms[1], { special: 1 });
    build.line(top[2], bottom[2], rooms[1], rooms[2]);
    build.line(bottom[3], top[3], rooms[3], rooms[2], { special: 1 });
    build.map.things.push({ x: 64, y: 64, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.plainDoors).toBe(1);
    expect(
      map.sectors.find((sector) => sector.id === "s1")?.door,
    ).toBeDefined();
    const plain = defined(map.sectors.find((sector) => sector.id === "s2"));
    expect(plain.door).toBeUndefined();
    expect(plain.ceiling).toBeGreaterThan(plain.floor);
    expect(validateMap(map)).toEqual([]);
  });

  it("keeps a teleporter whose landing only appears in network games", () => {
    const teleporter = (flags: number) => {
      const build = doomMap();
      const hall = build.sector();
      const pad = build.sector({ tag: 5 });
      const [a, b, c, d] = box(build, hall, [0, 0, 256, 256]);
      build.map.lines.length = 0;
      build.map.sides.length = 0;
      const e = build.vertex(512, 256);
      const f = build.vertex(512, 0);
      build.line(a, b, hall);
      build.line(b, c, hall);
      build.line(c, d, hall, pad, { special: 97, tag: 5 });
      build.line(d, a, hall);
      build.line(c, e, pad);
      build.line(e, f, pad);
      build.line(f, d, pad);
      build.map.things.push(
        { x: 64, y: 64, angle: 0, type: 1, flags: 7 },
        { x: 384, y: 128, angle: 0, type: 14, flags },
      );
      return decompileMap(build.map);
    };
    const solo = teleporter(7);
    expect(
      Object.values(solo.map.lines ?? {}).some((line) => line.action),
    ).toBe(true);
    const { map, report } = teleporter(7 | 16);
    expect(Object.values(map.lines ?? {}).some((line) => line.action)).toBe(
      true,
    );
    expect(
      map.things.find((thing) => thing.kind === "teleport-destination"),
    ).toMatchObject({ multiplayer: true });
    expect(report.droppedActions).toEqual({});
    expect(validateMap(map)).toEqual([]);
    const { map: lost, report: lostReport } = teleporter(0);
    expect(Object.values(lost.lines ?? {}).some((line) => line.action)).toBe(
      false,
    );
    expect(lostReport.droppedActions).toEqual({
      "Teleporters with nowhere to land": 1,
    });
  });

  it("drops a teleporter whose landing stands on a room inside the tagged one", () => {
    const wall = wallKey("e", "f");
    const map: GameMap = {
      ...islandMap,
      sectors: islandMap.sectors.map((sector) =>
        sector.id === "yard" ? { ...sector, tag: 5 } : sector,
      ),
      lines: {
        [wall]: {
          action: { kind: "teleport", trigger: "walk", repeat: true, tag: 5 },
        },
      },
      things: [
        ...islandMap.things,
        {
          id: "teleport-destination-1",
          kind: "teleport-destination",
          x: 256,
          y: 256,
          angle: 0,
        },
      ],
    };
    // The engine lands on the sector the spot stands in, which is the stage.
    expect(validateMap(map).map((issue) => issue.id)).toEqual([
      `line-teleport:${wall}`,
    ]);
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    const { map: read, report } = decompileMap(doom);
    expect(report.droppedActions).toEqual({
      "Teleporters with nowhere to land": 1,
    });
    expect(validateMap(read)).toEqual([]);
  });

  it("keeps scrolling walls on the side that scrolls", () => {
    const build = doomMap();
    const hall = build.sector();
    const room = build.sector({ light: 200 });
    const [a, b, c, d] = box(build, hall, [0, 0, 256, 256]);
    build.map.lines.length = 0;
    build.map.sides.length = 0;
    const e = build.vertex(512, 256);
    const f = build.vertex(512, 0);
    build.line(a, b, hall, null, { special: 48 });
    build.line(b, c, hall);
    build.line(d, c, room, hall, { special: 48 });
    build.line(d, a, hall);
    build.line(c, e, room);
    build.line(e, f, room);
    build.line(f, d, room);
    build.map.things.push({ x: 64, y: 64, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.droppedActions).toEqual({});
    const scrolling = Object.values(map.lines ?? {}).filter(
      (line) => line.scrolls,
    );
    expect(scrolling).toHaveLength(2);
    expect(scrolling.find((line) => line.front)?.front).toBe("s1");
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    const lines = doom.lines.filter((item) => item.special === 48);
    expect(lines).toHaveLength(2);
    const open = defined(lines.find((item) => item.back !== null));
    expect(doom.sectors[doom.sides[defined(open.front)].sector].light).toBe(
      200,
    );
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps see-through middle textures on open lines", () => {
    const build = doomMap();
    const hall = build.sector();
    const room = build.sector();
    const [a, b, c, d] = box(build, hall, [0, 0, 256, 256]);
    build.map.lines.length = 0;
    build.map.sides.length = 0;
    const e = build.vertex(512, 256);
    const f = build.vertex(512, 0);
    build.line(a, b, hall);
    build.line(b, c, hall);
    build.line(c, d, hall, room, { middle: "MIDGRATE" });
    build.line(d, a, hall);
    build.line(c, e, room);
    build.line(e, f, room);
    build.line(f, d, room);
    build.map.things.push({ x: 64, y: 64, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.seeThroughWalls).toBe(0);
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    expect(
      doom.sides.filter((side) => side.middle === "MIDGRATE"),
    ).toHaveLength(1);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("passes on specials, effects and flags the editor has no name for", () => {
    const build = doomMap();
    const room = build.sector({ special: 65 });
    const next = build.sector({ floorTexture: "BTSXFLAT" });
    const [a, b, c, d] = box(build, room, [0, 0, 256, 256]);
    build.map.lines.length = 0;
    build.map.sides.length = 0;
    const e = build.vertex(512, 256);
    const f = build.vertex(512, 0);
    build.line(a, b, room, null, { middle: "BTSXWALL" });
    // A Boom walk-over special on a solid wall does nothing, like a vanilla one.
    build.line(b, c, room, null, { special: 0x6000 });
    build.line(c, d, room, next, { special: 242, middle: "BTSXMID" });
    build.line(d, a, room);
    build.line(c, e, next);
    build.line(e, f, next);
    build.line(f, d, next);
    build.map.things.push(
      { x: 32, y: 32, angle: 0, type: 1, flags: 7 },
      { x: 64, y: 64, angle: 0, type: 32000, flags: 7 },
      { x: 96, y: 96, angle: 0, type: 38, flags: 7 },
      { x: 128, y: 128, angle: 0, type: 3001, flags: 7 | 16 },
      { x: 2000, y: 2000, angle: 0, type: 3001, flags: 7 },
    );

    const { map, report } = decompileMap(build.map);
    expect(report).toMatchObject({
      droppedThings: {},
      multiplayerThings: 0,
      outsideThings: 1,
      droppedActions: {},
      droppedEffects: 0,
      seeThroughWalls: 1,
      replacedTextures: ["BTSXFLAT", "BTSXWALL"],
    });
    expect(kinds(map)).toEqual(["custom", "imp", "player", "red-skull-key"]);
    expect(map.things.find((thing) => thing.kind === "custom")?.type).toBe(
      32000,
    );
    expect(map.complevel).toBe("boom");
    expect(map.sectors[0].rawEffect).toBe(65);
    expect(map.lines?.[wallKey("v2", "v3")]?.raw).toEqual({
      special: 242,
      tag: 0,
    });
    expect(map.lines?.[wallKey("v1", "v2")]).toBeUndefined();
    // Another game's names decide what the importer keeps.
    const bare = decompileMap(build.map, {
      walls: [],
      flats: [],
      middles: [],
      custom: [],
      textures: [],
    });
    expect(bare.report.replacedTextures).toContain("STARTAN3");
    expect(bare.report.replacedTextures).toContain("FLOOR4_8");
    expect(map.things.find((thing) => thing.kind === "imp")).toMatchObject({
      multiplayer: true,
    });
    expect(validateMap(map)).toEqual([]);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });
});

function kinds(map: GameMap) {
  return map.things.map((thing) => thing.kind).toSorted();
}

// Corners go clockwise, so the room is on the right of every wall.
function box(
  build: ReturnType<typeof doomMap>,
  sector: number,
  [left, bottom, right, top]: number[],
) {
  const corners = [
    build.vertex(left, bottom),
    build.vertex(left, top),
    build.vertex(right, top),
    build.vertex(right, bottom),
  ];
  corners.forEach((corner, index) =>
    build.line(corner, corners[(index + 1) % 4], sector),
  );
  return corners;
}

describe("doors line by line", () => {
  it("keeps a secret door that wears the wall around it", () => {
    const build = doomMap();
    const rooms = [
      build.sector(),
      build.sector({ ceiling: 0 }),
      build.sector(),
    ];
    const xs = [0, 256, 288, 544];
    const top = xs.map((x) => build.vertex(x, 128));
    const bottom = xs.map((x) => build.vertex(x, 0));
    build.line(bottom[0], top[0], rooms[0]);
    build.line(top[3], bottom[3], rooms[2]);
    rooms.forEach((room, index) => {
      build.line(top[index], top[index + 1], room);
      build.line(bottom[index + 1], bottom[index], room);
    });
    const side = (sector: number, upper: string) =>
      build.map.sides.push({
        offsetX: 0,
        offsetY: 0,
        upper,
        lower: "-",
        middle: "-",
        sector,
      }) - 1;
    build.map.lines.push(
      {
        start: top[1],
        end: bottom[1],
        flags: 4,
        special: 31,
        tag: 0,
        front: side(rooms[0], "STARTAN3"),
        back: side(rooms[1], "-"),
      },
      {
        start: bottom[2],
        end: top[2],
        flags: 4,
        special: 31,
        tag: 0,
        front: side(rooms[2], "STARTAN3"),
        back: side(rooms[1], "-"),
      },
    );
    build.map.things.push({ x: 64, y: 64, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    const door = defined(map.sectors.find((sector) => sector.id === "s1"));
    expect(door.door?.texture).toBe("STARTAN3");
    expect(report.replacedTextures).not.toContain("STARTAN3");
    expect(Object.values(map.lines ?? {}).some((line) => line.sides)).toBe(
      false,
    );
  });

  it("keeps each line's own way of opening a door, its face and its pegging", () => {
    const build = doomMap();
    const rooms = [
      build.sector(),
      build.sector({ ceiling: 0 }),
      build.sector(),
    ];
    const xs = [0, 256, 288, 544];
    const top = xs.map((x) => build.vertex(x, 128));
    const bottom = xs.map((x) => build.vertex(x, 0));
    build.line(bottom[0], top[0], rooms[0]);
    build.line(top[3], bottom[3], rooms[2]);
    rooms.forEach((room, index) => {
      build.line(top[index], top[index + 1], room);
      build.line(bottom[index + 1], bottom[index], room);
    });
    // The door's top track is pegged to the floor and its bottom one is not.
    const [topTrack] = build.map.lines.filter(
      (line) => build.map.sides[defined(line.front)].sector === rooms[1],
    );
    topTrack.flags |= 0x10;
    const side = (sector: number, upper: string) =>
      build.map.sides.push({
        offsetX: 0,
        offsetY: 0,
        upper,
        lower: "-",
        middle: "-",
        sector,
      }) - 1;
    build.map.lines.push(
      {
        start: top[1],
        end: bottom[1],
        flags: 4,
        special: 1,
        tag: 3,
        front: side(rooms[0], "BIGDOOR2"),
        back: side(rooms[1], "-"),
      },
      {
        start: bottom[2],
        end: top[2],
        flags: 4,
        special: 0,
        tag: 0,
        front: side(rooms[2], "BIGDOOR4"),
        back: side(rooms[1], "-"),
      },
    );
    build.map.things.push({ x: 64, y: 64, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.plainDoors).toBe(0);
    const door = defined(map.sectors.find((sector) => sector.id === "s1"));
    expect(door.door).toEqual({
      opensBy: "use",
      closes: true,
      texture: "BIGDOOR2",
    });
    const wallBetween = (a: number, b: number) =>
      defined(
        Object.entries(map.lines ?? {}).find(([key]) => {
          const [from, to] = key.split("|").map((id) => map.vertices[id]);
          return (
            [from.x, to.x].toSorted((x, y) => x - y).join() ===
            [a, b].toSorted((x, y) => x - y).join()
          );
        }),
      )[1];
    expect(wallBetween(256, 256)).toEqual({
      action: { kind: "door-raise", trigger: "door", repeat: true, tag: 3 },
    });
    expect(wallBetween(288, 288)).toEqual({
      shut: true,
      sides: { s2: { upper: "BIGDOOR4" } },
    });
    const trackSettings = Object.entries(map.lines ?? {}).filter(([key]) => {
      const [from, to] = key.split("|").map((id) => map.vertices[id]);
      return from.y === to.y && from.x >= 256 && to.x <= 288;
    });
    expect(trackSettings.map(([, settings]) => settings)).toEqual(
      expect.arrayContaining([{ lowerFixed: true }, { lowerFixed: false }]),
    );
    expect(trackSettings).toHaveLength(2);
    expect(validateMap(map)).toEqual([]);
    expect(parseMapFile(serializeMap(map))).toEqual(map);

    const [again] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    const at = (x: number) =>
      again.lines.filter(
        (line) =>
          again.vertices[line.start].x === x &&
          again.vertices[line.end].x === x,
      );
    expect(at(256)).toMatchObject([{ special: 1, tag: 3 }]);
    expect(at(288)).toMatchObject([{ special: 0, tag: 0 }]);
    const [shut] = at(288);
    const faces = [shut.front, shut.back].map(
      (index) => again.sides[defined(index)],
    );
    expect(faces.find((face) => face.sector === 2)?.upper).toBe("BIGDOOR4");
    expect(faces.find((face) => face.sector === 1)?.upper).toBe("BIGDOOR2");
    const tracks = again.lines.filter(
      (line) =>
        line.back === null && again.sides[defined(line.front)].sector === 1,
    );
    expect(
      tracks.map((line) => line.flags & 0x10).toSorted((a, b) => a - b),
    ).toEqual([0, 0x10]);
  });
});

function doomMap() {
  const map: DoomMap = {
    slot: "MAP01",
    vertices: [],
    lines: [],
    sides: [],
    sectors: [],
    things: [],
  };
  const side = (
    sector: number,
    textures: Partial<DoomMap["sides"][0]> = {},
  ) => {
    map.sides.push({
      offsetX: 0,
      offsetY: 0,
      upper: "-",
      lower: "-",
      middle: "-",
      sector,
      ...textures,
    });
    return map.sides.length - 1;
  };
  return {
    map,
    vertex: (x: number, y: number) => map.vertices.push({ x, y }) - 1,
    sector: (settings: Partial<DoomSector> = {}) =>
      map.sectors.push({
        floor: 0,
        ceiling: 128,
        floorTexture: "FLOOR4_8",
        ceilingTexture: "CEIL3_5",
        light: 160,
        special: 0,
        tag: 0,
        ...settings,
      }) - 1,
    // The front sector sits on the right of start -> end, as in the engine.
    line: (
      start: number,
      end: number,
      front: number,
      back: number | null = null,
      extra: { special?: number; tag?: number; middle?: string } = {},
    ) => {
      map.lines.push({
        start,
        end,
        flags: back === null ? 1 : 4,
        special: extra.special ?? 0,
        tag: extra.tag ?? 0,
        front: side(
          front,
          back === null
            ? { middle: extra.middle ?? "STARTAN3" }
            : { upper: "STARTAN3", lower: "STARTAN3", middle: extra.middle },
        ),
        back:
          back === null
            ? null
            : side(back, { upper: "STARTAN3", lower: "STARTAN3" }),
      });
    },
  };
}

describe("readMaps", () => {
  it("lets a later WAD replace a map in the same slot", () => {
    const episode = compileEpisode([
      { slot: "MAP01", map: starterMap },
      { slot: "MAP02", map: starterMap },
    ]);
    const patch = compileMap(testMap, "MAP02");
    const maps = readMaps([
      { name: "episode.wad", data: episode },
      { name: "patch.wad", data: patch },
    ]);
    expect(maps.map((map) => map.slot)).toEqual(["MAP01", "MAP02"]);
    expect(maps[1].things).toHaveLength(testMap.things.length);
  });

  it("reads Doom 1 maps too", () => {
    const maps = readMaps([
      { name: "d.wad", data: compileMap(testMap, "E1M1") },
    ]);
    expect(maps.map((map) => map.slot)).toEqual(["E1M1"]);
    expect(maps[0].things).toHaveLength(testMap.things.length);
  });

  it("names maps after the titles a patch or UMAPINFO gives them", () => {
    const lump = (name: string, body: string) => {
      const data = new TextEncoder().encode(body);
      const wad = new Uint8Array(12 + data.length + 16);
      const view = new DataView(wad.buffer);
      wad.set(new TextEncoder().encode("PWAD"));
      view.setInt32(4, 1, true);
      view.setInt32(8, 12 + data.length, true);
      wad.set(data, 12);
      view.setInt32(12 + data.length, 12, true);
      view.setInt32(12 + data.length + 4, data.length, true);
      wad.set(new TextEncoder().encode(name), 12 + data.length + 8);
      return { name: `${name}.wad`, data: wad };
    };
    const episode = compileEpisode(
      ["MAP01", "MAP02", "MAP03"].map((slot) => ({ slot, map: starterMap })),
    );
    const maps = readMaps([
      { name: "episode.wad", data: episode },
      lump(
        "DEHACKED",
        "[STRINGS]\nHUSTR_1 = MAP01: Hydroelectric Plant\nPHUSTR_2 = level 2: Wrong\nHUSTR_3 = MAP03\n",
      ),
      lump("UMAPINFO", 'map MAP02\n{\n  levelname = "Filtration Tunnels"\n}\n'),
    ]);
    // The episode's own UMAPINFO names every map; later files win.
    expect(maps.map((map) => map.title)).toEqual([
      "Hydroelectric Plant",
      "Filtration Tunnels",
      "Starter map",
    ]);
    expect(decompileMap(maps[0]).map.name).toBe("Hydroelectric Plant");
    expect(decompileMap(maps[2]).map.name).toBe("Starter map");
    const doomOne = readMaps([
      { name: "d.wad", data: compileMap(starterMap, "E1M1") },
      lump("UMAPINFO", 'map E1M1\n{\n  levelname = "Hangar"\n}\n'),
    ]);
    expect(doomOne[0].title).toBe("Hangar");
  });

  it("explains WADs the editor can't open", () => {
    const wad = (names: string[]) => {
      const directory = new Uint8Array(12 + names.length * 16);
      const view = new DataView(directory.buffer);
      directory.set(new TextEncoder().encode("PWAD"));
      view.setInt32(4, names.length, true);
      view.setInt32(8, 12, true);
      names.forEach((name, index) =>
        directory.set(new TextEncoder().encode(name), 12 + index * 16 + 8),
      );
      return directory;
    };
    expect(readMaps([{ name: "a.wad", data: wad(["E1M1"]) }])[0].slot).toBe(
      "E1M1",
    );
    expect(() =>
      readMaps([{ name: "a.wad", data: wad(["MAP01", "TEXTMAP"]) }]),
    ).toThrow(WadFileError);
  });
});

describe.skipIf(!existsSync(freedoom))("Freedoom's maps", () => {
  let maps: DoomMap[] = [];

  beforeAll(() => {
    maps = readMaps([
      { name: "freedoom2.wad", data: new Uint8Array(readFileSync(freedoom)) },
    ]);
  });

  it("convert into levels that pass every check and save", () => {
    expect(maps).toHaveLength(32);
    expect(maps.every((doom) => doom.title)).toBe(true);
    let pillars = 0;
    for (const doom of maps) {
      const { map, report } = decompileMap(doom);
      pillars += map.sectors.filter((sector) => sector.holes).length;
      expect(validateMap(map), doom.slot).toEqual([]);
      expect(report.innerLines, doom.slot).toBe(0);
      // A teleporter that only lands on a multiplayer-only spot has nowhere to go.
      expect(
        Object.keys(report.droppedActions).filter(
          (group) => group !== "Teleporters with nowhere to land",
        ),
        doom.slot,
      ).toEqual([]);
      expect(report.droppedEffects, doom.slot).toBe(0);
      expect(() => parseMapFile(serializeMap(map))).not.toThrow();
      expect(map.things.every((thing) => thingCatalog[thing.kind])).toBe(true);
    }
    expect(pillars).toBeGreaterThan(0);
  }, 60_000);

  it("build into WADs again", () => {
    for (const slot of ["MAP01", "MAP13", "MAP27"]) {
      const { map } = decompileMap(
        defined(maps.find((doom) => doom.slot === slot)),
      );
      expect(() => compileMap(map), slot).not.toThrow();
    }
  }, 60_000);
});
