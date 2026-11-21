import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

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

    const { map } = decompileMap(build.map);
    expect(map.sectors.map((sector) => sector.id)).toEqual(["s0", "s1"]);
    expect(
      Object.values(map.lines ?? {}).find((line) => line.action),
    ).toMatchObject({
      front: "s1",
    });
    const [doom] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    const line = doom.lines.find((item) => item.special === 62)!;
    expect(doom.sectors[doom.sides[line.front!].sector].tag).toBe(0);
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
    const plain = map.sectors.find((sector) => sector.id === "s2")!;
    expect(plain.door).toBeUndefined();
    expect(plain.ceiling).toBeGreaterThan(plain.floor);
    expect(validateMap(map)).toEqual([]);
  });

  it("drops a teleporter that only leads to a multiplayer spot", () => {
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
      false,
    );
    expect(report.droppedActions).toEqual({
      "Teleporters to multiplayer spots": 1,
    });
    expect(validateMap(map)).toEqual([]);
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
    const open = lines.find((item) => item.back !== null)!;
    expect(doom.sectors[doom.sides[open.front!].sector].light).toBe(200);
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
    build.line(c, d, room, next, { special: 242, middle: "MIDGRATE" });
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
      droppedThings: { "Other things": 1 },
      multiplayerThings: 1,
      outsideThings: 1,
      droppedActions: { "Boom and later actions": 1 },
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
    expect(maps.map((map) => map.title)).toEqual([
      "Hydroelectric Plant",
      "Filtration Tunnels",
      undefined,
    ]);
    expect(decompileMap(maps[0]).map.name).toBe("Hydroelectric Plant");
    expect(decompileMap(maps[2]).map.name).toBe("MAP03");
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
  let maps: DoomMap[] = [];

  beforeAll(() => {
    maps = readMaps([
      { name: "freedoom2.wad", data: new Uint8Array(readFileSync(freedoom)) },
    ]);
  });

  it("convert into levels that pass every check and save", () => {
    expect(maps).toHaveLength(32);
    expect(maps.every((doom) => doom.title)).toBe(true);
    for (const doom of maps) {
      const { map, report } = decompileMap(doom);
      expect(validateMap(map), doom.slot).toEqual([]);
      // A teleporter that only lands on a multiplayer-only spot has nowhere to go.
      expect(
        Object.keys(report.droppedActions).filter(
          (group) => group !== "Teleporters to multiplayer spots",
        ),
        doom.slot,
      ).toEqual([]);
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
