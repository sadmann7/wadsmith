import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { thingCatalog } from "../map/catalog";
import { pointInPolygon, sectorPolygon } from "../map/geometry";
import { starterMap } from "../map/starter-map";
import { parseMapFile, serializeMap } from "../map/storage";
import { testMap } from "../map/test-map";
import type { GameMap } from "../map/types";
import { validateMap } from "../map/validate";
import { compileEpisode, compileMap } from "./compile";
import { decompileMap } from "./decompile";
import { WadFileError } from "./inspect";
import { readMaps, type DoomMap, type DoomSector } from "./read-map";

const freedoom = resolve(
  import.meta.dirname,
  "../../public/engine/freedoom2.wad",
);

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

function kinds(map: GameMap) {
  return map.things.map((thing) => thing.kind).toSorted();
}

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

  it("cuts a sector around a pillar into rooms without holes", () => {
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
    expect(report.splitSectors).toBe(1);
    expect(map.sectors.length).toBeGreaterThan(1);
    expect(validateMap(map)).toEqual([]);
    expect(
      map.sectors.some((sector) =>
        pointInPolygon({ x: 128, y: -128 }, sectorPolygon(map, sector)),
      ),
    ).toBe(false);
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
    build.map.sides[build.map.lines.at(-1)!.front!].lower = "SW1BRIK";
    build.line(c, e, hall);
    build.line(e, f, hall);
    build.line(f, d, hall);
    build.map.things.push({ x: 192, y: 64, angle: 0, type: 1, flags: 7 });

    const { map, report } = decompileMap(build.map);
    expect(report.backwardSwitches).toBe(0);
    expect(map.sectors.map((sector) => sector.id)).toEqual(["s1", "s0"]);
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    const line = doom.lines.find((item) => item.special === 62)!;
    expect(doom.sides[line.front!].sector).toBe(0);
    expect(doom.sectors[0].tag).toBe(0);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("reports what the editor can't hold yet", () => {
    const build = doomMap();
    const room = build.sector({ special: 4 });
    const next = build.sector({ floorTexture: "BTSXFLAT" });
    const [a, b, c, d] = box(build, room, [0, 0, 256, 256]);
    build.map.lines.length = 0;
    build.map.sides.length = 0;
    const e = build.vertex(512, 256);
    const f = build.vertex(512, 0);
    build.line(a, b, room, null, { middle: "BTSXWALL" });
    build.line(b, c, room);
    build.line(c, d, room, next, { special: 97, tag: 3, middle: "MIDGRATE" });
    build.line(d, a, room);
    build.line(c, e, next);
    build.line(e, f, next);
    build.line(f, d, next);
    build.map.things.push(
      { x: 32, y: 32, angle: 0, type: 1, flags: 7 },
      { x: 64, y: 64, angle: 0, type: 14, flags: 7 },
      { x: 96, y: 96, angle: 0, type: 38, flags: 7 },
      { x: 128, y: 128, angle: 0, type: 3001, flags: 7 | 16 },
      { x: 2000, y: 2000, angle: 0, type: 3001, flags: 7 },
    );

    const { map, report } = decompileMap(build.map);
    expect(report).toMatchObject({
      droppedThings: { "Teleport destination": 1 },
      multiplayerThings: 1,
      outsideThings: 1,
      droppedActions: { Teleporters: 1 },
      droppedEffects: 1,
      seeThroughWalls: 1,
      replacedTextures: ["BTSXFLAT", "BTSXWALL"],
    });
    expect(kinds(map)).toEqual(["player", "red-skull-key"]);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });
});

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
    expect(() => readMaps([{ name: "a.wad", data: wad(["E1M1"]) }])).toThrow(
      /Doom 1 maps/,
    );
    expect(() =>
      readMaps([{ name: "a.wad", data: wad(["MAP01", "TEXTMAP"]) }]),
    ).toThrow(WadFileError);
  });
});

describe.skipIf(!existsSync(freedoom))("Freedoom's maps", () => {
  const maps = readMaps([
    { name: "freedoom2.wad", data: new Uint8Array(readFileSync(freedoom)) },
  ]);

  it("convert into rooms that keep their shape and save", () => {
    expect(maps).toHaveLength(32);
    for (const doom of maps) {
      const { map } = decompileMap(doom);
      const kinds = new Set(
        validateMap(map).map((issue) => issue.id.split(":")[0]),
      );
      for (const kind of ["twist", "repeat", "cross", "overlap", "shared"]) {
        expect(kinds.has(kind), `${doom.slot} ${kind}`).toBe(false);
      }
      expect(() => parseMapFile(serializeMap(map))).not.toThrow();
      expect(map.things.every((thing) => thingCatalog[thing.kind])).toBe(true);
    }
  }, 60_000);

  it("build into WADs again", () => {
    for (const slot of ["MAP01", "MAP13", "MAP27"]) {
      const { map } = decompileMap(maps.find((doom) => doom.slot === slot)!);
      expect(() => compileMap(map), slot).not.toThrow();
    }
  }, 60_000);
});
