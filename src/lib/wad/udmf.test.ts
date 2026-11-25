import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { mapWarnings } from "@/lib/map/checks";
import { hexenTranslations } from "@/lib/map/hexen-actions";
import { starterMap } from "@/lib/map/starter-map";
import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { testMap } from "@/lib/map/test-map";

import { compileMap } from "./compile";
import { decompileMap } from "./decompile";
import { WadFileError } from "./inspect";
import { type DoomMap, readMaps } from "./read-map";
import { packTestWad, packUdmfTestWad } from "./test-wad";
import { readTextmap } from "./udmf";

const freedoom = resolve(
  import.meta.dirname,
  "../../../public/engine/freedoom2.wad",
);

const encode = (value: string) => new TextEncoder().encode(value);

const udmfWad = (...maps: [string, string][]) => ({
  name: "udmf.wad",
  data: packTestWad(
    maps.flatMap(([slot, textmap]) => [
      { name: slot, data: new Uint8Array() },
      { name: "TEXTMAP", data: encode(textmap) },
      { name: "ZNODES", data: new Uint8Array(4) },
      { name: "ENDMAP", data: new Uint8Array() },
    ]),
  ),
});

const room = (namespace: string, extra = "") => `
  namespace = "${namespace}";
  vertex { x = 0.0; y = 0.0; }
  vertex { x = 256.0; y = 0.0; }
  vertex { x = 256.0; y = 256.0; }
  vertex { x = 0.0; y = 256.0; }
  linedef { v1 = 1; v2 = 0; sidefront = 0; blocking = true; }
  linedef { v1 = 2; v2 = 1; sidefront = 1; blocking = true; }
  linedef { v1 = 3; v2 = 2; sidefront = 2; blocking = true; }
  linedef { v1 = 0; v2 = 3; sidefront = 3; blocking = true; }
  sidedef { sector = 0; texturemiddle = "STARTAN3"; }
  sidedef { sector = 0; texturemiddle = "STARTAN3"; }
  sidedef { sector = 0; texturemiddle = "STARTAN3"; }
  sidedef { sector = 0; texturemiddle = "STARTAN3"; }
  sector { heightceiling = 128; texturefloor = "FLOOR4_8";
    textureceiling = "CEIL3_5"; }
  thing { x = 128.0; y = 128.0; type = 1; angle = 90; skill1 = true;
    skill2 = true; skill3 = true; skill4 = true; skill5 = true;
    single = true; coop = true; dm = true; }
  ${extra}
`;

describe("UDMF maps", () => {
  it("open from a WAD into the same editor map as their classic build", () => {
    const [classic] = readMaps([
      { name: "map.wad", data: compileMap(starterMap) },
    ]);
    const [udmf] = readMaps([udmfWad(["MAP01", toTextmap(classic)])]);
    expect(udmf.udmf).toEqual({
      namespace: "doom",
      droppedFields: {},
      droppedActions: {},
    });
    const { map, report } = decompileMap(udmf);
    expect(map).toEqual(decompileMap({ ...classic, title: undefined }).map);
    expect(report.namespace).toBe("doom");
    expect(report.droppedFields).toEqual({});
  });

  it("open next to classic maps, each in its own slot", () => {
    const maps = readMaps([
      { name: "map.wad", data: compileMap(starterMap, "MAP01") },
      udmfWad(["MAP02", room("doom")], ["MAP03", room("woof")]),
    ]);
    expect(maps.map((map) => [map.slot, map.udmf?.namespace])).toEqual([
      ["MAP01", undefined],
      ["MAP02", "doom"],
      ["MAP03", "woof"],
    ]);
  });

  it.skipIf(!existsSync(freedoom))(
    "bring every Freedoom map through TEXTMAP unchanged",
    () => {
      const maps = readMaps([
        { name: "freedoom2.wad", data: new Uint8Array(readFileSync(freedoom)) },
      ]);
      expect(maps).toHaveLength(32);
      for (const doom of maps) {
        const plain = { ...doom, title: undefined };
        const { udmf, ...read } = readTextmap(doom.slot, toTextmap(doom));
        expect(read, doom.slot).toEqual(plain);
        expect(udmf?.droppedFields, doom.slot).toEqual({});
        const { map } = decompileMap({ ...read, udmf });
        expect(map, doom.slot).toEqual(decompileMap(plain).map);
        expect(parseMapFile(serializeMap(map)), doom.slot).toEqual(map);
      }
    },
    300_000,
  );

  it.skipIf(!existsSync(freedoom))(
    "keep every Freedoom map's actions through a zdoom TEXTMAP",
    () => {
      const maps = readMaps([
        { name: "freedoom2.wad", data: new Uint8Array(readFileSync(freedoom)) },
      ]);
      for (const doom of maps) {
        const plain = { ...doom, title: undefined };
        const read = readTextmap(doom.slot, toTextmap(doom, "zdoom"));
        expect(read.udmf, doom.slot).toEqual({
          namespace: "zdoom",
          droppedFields: {},
          droppedActions: {},
        });
        expect(
          read.lines.map(({ special, tag }) => [special, tag]),
          doom.slot,
        ).toEqual(doom.lines.map(({ special, tag }) => [special, tag]));
        expect(read.sectors, doom.slot).toEqual(doom.sectors);
        const { map } = decompileMap(read);
        const classic = decompileMap(plain).map;
        expect(map, doom.slot).toEqual(classic);
        expect(mapWarnings(map).length, doom.slot).toBe(
          mapWarnings(classic).length,
        );
        expect(parseMapFile(serializeMap(map)), doom.slot).toEqual(map);
      }
    },
    300_000,
  );

  it("report each field a zdoom map loses, with the namespace", () => {
    const source = `
      // Written by Ultimate Doom Builder.
      NAMESPACE = "zdoom";
      /* A global user field. */ user_score = 0x10;
      vertex { x = 0.0; y = 0.0; }
      vertex { X = 256.0; y = 0; }
      vertex { x = 256; y = 256; zfloor = 8.0; }
      vertex { x = 0; y = 256.0; }
      linedef { v1 = 1; v2 = 0; sidefront = 0; Blocking = TRUE;
        special = 12; arg0 = 7; arg1 = 16; playeruse = true;
        repeatspecial = true; alpha = 0.5; }
      linedef { v1 = 2; v2 = 1; sidefront = 1; blocking = true; id = 3;
        moreids = "4 5"; }
      linedef { v1 = 3; v2 = 2; sidefront = 2; blocking = true; id = -1; }
      linedef { v1 = 0; v2 = 3; sidefront = 3; blocking = true;
        jumpover = false; }
      sidedef { sector = 0; texturemiddle = "startan3"; offsetx_mid = 4.0; }
      sidedef { sector = 0; texturemiddle = "STARTAN3"; scalex_mid = 1.5; }
      sidedef { sector = 0; texturemiddle = "STARTAN3"; offsetx_mid = 0.0; }
      sidedef { sector = 0; texturemiddle = "STARTAN3"; }
      sector { texturefloor = "floor4_8"; textureceiling = "ceil3_5";
        heightceiling = 128; special = 65; lightcolor = 0xff0000;
        comment = "a \\"room\\""; }
      thing { x = 127.6; y = 128.0; height = 24; type = 1; skill1 = true;
        skill2 = true; skill3 = true; single = true; user_tag = "boss"; }
      thing { x = 64.0; y = 64.0; type = 3001; skill3 = true; single = true;
        id = 9; special = 80; arg0 = 1; }
      zdoom_extras { flag = true; }
    `;
    const [doom] = readMaps([udmfWad(["MAP01", source])]);
    expect(doom.vertices[1]).toEqual({ x: 256, y: 0 });
    expect(doom.lines[0]).toMatchObject({ flags: 1, special: 63, tag: 7 });
    expect(doom.lines.map((line) => line.tag)).toEqual([7, 3, 0, 0]);
    expect(doom.sides[0].middle).toBe("STARTAN3");
    expect(doom.sectors[0]).toMatchObject({ light: 160, special: 1 });
    const { map, report } = decompileMap(doom);
    expect(map.sectors).toHaveLength(1);
    expect(map.things).toHaveLength(2);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(report.namespace).toBe("zdoom");
    expect(report.droppedActions).toEqual({});
    expect(report.nearestActions).toEqual({ Door_Raise: 1 });
    expect(report.droppedFields).toEqual({
      user_score: 1,
      zdoom_extras: 1,
      "vertex.zfloor": 1,
      "linedef.alpha": 1,
      "linedef.moreids": 1,
      "sidedef.offsetx_mid": 1,
      "sidedef.scalex_mid": 1,
      "sector.lightcolor": 1,
      "thing.height": 1,
      "thing.user_tag": 1,
      "thing.id": 1,
      "thing.special": 1,
      "thing.arg0": 1,
    });
  });

  it("keep Doom specials and tags in the doom and woof namespaces", () => {
    for (const namespace of ["doom", "woof"]) {
      const doom = readTextmap(
        "MAP01",
        `namespace = "${namespace}";
        linedef { v1 = 1; v2 = 0; sidefront = 0; special = 1; }
        linedef { v1 = 1; v2 = 0; sidefront = 0; special = 23; arg0 = 4; }
        linedef { v1 = 1; v2 = 0; sidefront = 0; id = 6; }
        linedef { v1 = 1; v2 = 0; sidefront = 0; special = 23; arg0 = 4;
          id = 6; }
        linedef { v1 = 1; v2 = 0; sidefront = 0; special = 23; id = 7; }
        sector { texturefloor = "F"; textureceiling = "C"; special = 9;
          id = 4; }`,
      );
      expect(doom.lines.map(({ special, tag }) => [special, tag])).toEqual([
        [1, 0],
        [23, 4],
        [0, 6],
        [23, 4],
        [23, 0],
      ]);
      expect(doom.sectors[0]).toMatchObject({ special: 9, tag: 4 });
      expect(doom.udmf?.droppedFields).toEqual({ "linedef.id": 2 });
      expect(doom.udmf?.droppedActions).toEqual({});
    }
  });

  it("keep a Hexen-format line id as the tag of a line with no action", () => {
    const doom = readTextmap(
      "MAP01",
      `namespace = "zdoom";
      linedef { v1 = 1; v2 = 0; sidefront = 0; id = 6; }
      linedef { v1 = 1; v2 = 0; sidefront = 0; special = 9999; id = 7;
        playeruse = true; }`,
    );
    expect(doom.lines.map(({ special, tag }) => [special, tag])).toEqual([
      [0, 6],
      [0, 7],
    ]);
    expect(doom.udmf?.droppedFields).toEqual({});
  });

  it("keep a line id through import, save and build", () => {
    const [doom] = readMaps([
      udmfWad([
        "MAP01",
        room("zdoom").replace(
          "sidefront = 0; blocking = true;",
          "sidefront = 0; blocking = true; id = 3;",
        ),
      ]),
    ]);
    const { map } = decompileMap(doom);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    const tagged = Object.values(map.lines ?? {}).flatMap(
      (line) => line.raw ?? [],
    );
    expect(tagged).toEqual([{ special: 0, tag: 3 }]);
    const [built] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    expect(built.lines.filter((line) => line.tag === 3)).toHaveLength(1);
  });

  it("count a Hexen action as approximate when it has a trigger Doom can't add", () => {
    const doom = readTextmap(
      "MAP01",
      `namespace = "zdoom";
      linedef { v1 = 1; v2 = 0; sidefront = 0; special = 243; playeruse = true;
        playercross = true; }
      linedef { v1 = 1; v2 = 0; sidefront = 0; special = 243; impact = true; }`,
    );
    expect(doom.lines.map(({ special }) => special)).toEqual([11, 197]);
    expect(doom.lines.map(({ approximates }) => approximates)).toEqual([
      "Exit_Normal",
      undefined,
    ]);
  });

  it("count an approximate action only when the import keeps it", () => {
    const [doom] = readMaps([
      udmfWad([
        "MAP01",
        room("zdoom").replace(
          "sidefront = 0; blocking = true;",
          "sidefront = 0; blocking = true; special = 70; arg1 = 9; arg2 = 1; playercross = true;",
        ),
      ]),
    ]);
    const { report } = decompileMap(doom);
    expect(report.nearestActions).toEqual({});
  });

  it("place things on no difficulty and no game mode unless they say so", () => {
    const doom = readTextmap(
      "MAP01",
      `namespace = "doom"; thing { x = 0.0; y = 0.0; type = 3001; }
      thing { x = 0; y = 0; type = 3001; skill2 = true; coop = true; }`,
    );
    expect(doom.things.map((thing) => thing.flags)).toEqual([
      0x0010 | 0x0020 | 0x0040,
      0x0001 | 0x0010 | 0x0020,
    ]);
    expect(doom.things[0].angle).toBe(0);
  });

  it("renumber tags over 32767 and keep what they link", () => {
    const [doom] = readMaps([udmfWad(["MAP01", bigTagRoom])]);
    expect(doom.sectors[0].tag).toBe(40000);
    const { map, report } = decompileMap(doom);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(report.renumberedTags).toBe(1);
    const [line] = Object.values(map.lines ?? {});
    expect(line.action?.tag).toBe(map.sectors[0].tag);
  });

  it("open a door at the height limit only as far as the limit", () => {
    const [doom] = readMaps([udmfWad(["MAP01", doorAtLimit()])]);
    const { map, report } = decompileMap(doom);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(map.sectors.find((sector) => sector.door)?.ceiling).toBe(32767);
    expect(report.clampedHeights).toBe(1);
  });

  it.each([
    [
      "Generic_Floor",
      "special = 200; arg0 = 3; arg1 = 16; arg3 = 2; arg4 = 14; playeruse = true; repeatspecial = true;",
      0x6000 | 3 | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (2 << 10),
    ],
    [
      "Generic_Ceiling",
      "special = 201; arg0 = 3; arg1 = 64; arg2 = 32; arg4 = 16; impact = true;",
      0x4000 | 4 | (3 << 3) | (7 << 7) | (1 << 12),
    ],
    [
      "Generic_Door",
      "special = 202; arg0 = 3; arg1 = 64; arg3 = 69; playeruse = true; monsteruse = true; repeatspecial = true;",
      0x3c00 | 3 | (2 << 3) | (1 << 7) | (2 << 8),
    ],
    [
      "Generic_Door with a lock",
      "special = 202; arg0 = 3; arg1 = 16; arg2 = 1; arg4 = 130; playeruse = true;",
      0x3800 | 2 | (1 << 5) | (2 << 6) | (1 << 9),
    ],
    [
      "Generic_Lift",
      "special = 203; arg0 = 3; arg1 = 64; arg2 = 24; arg3 = 4; playeruse = true;",
      0x3400 | 2 | (2 << 3) | (1 << 6) | (3 << 8),
    ],
    [
      "Generic_Stairs",
      "special = 204; arg0 = 3; arg1 = 4; arg2 = 16; arg3 = 3; playeruse = true;",
      0x3000 | 2 | (1 << 3) | (2 << 6) | (1 << 8) | (1 << 9),
    ],
    [
      "Generic_CrusherDist",
      "special = 284; arg0 = 3; arg1 = 16; arg2 = 16; arg3 = 1; arg4 = 10; playeruse = true; repeatspecial = true;",
      0x2f80 | 3 | (1 << 3) | (1 << 6),
    ],
    [
      "MBF21 Scroll_Texture_Offsets",
      "special = 225; arg1 = 3; arg2 = 2; arg3 = 8;",
      1026,
    ],
  ])("keep %s through import, save and build", (_, fields, special) => {
    const textmap = room("zdoom")
      .replace(
        "sidefront = 0; blocking = true;",
        `sidefront = 0; blocking = true; ${fields}`,
      )
      .replace("heightceiling = 128;", "heightceiling = 128; id = 3;");
    const [doom] = readMaps([udmfWad(["MAP01", textmap])]);
    const { map, report } = decompileMap(doom);
    expect(report.droppedActions).toEqual({});
    expect(report.nearestActions).toEqual({});
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    const [built] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    expect(
      built.lines
        .filter((line) => line.special !== 0)
        .map((line) => [line.special, line.tag]),
    ).toEqual([[special, 3]]);
  });

  it("report the monsteractivate the map can't keep", () => {
    const doom = readTextmap(
      "MAP01",
      `namespace = "zdoom";
      linedef { v1 = 1; v2 = 0; sidefront = 0; }
      linedef { v1 = 1; v2 = 0; sidefront = 0; special = 21; arg0 = 3;
        arg1 = 8; playeruse = true; monsteractivate = true; }
      linedef { v1 = 1; v2 = 0; sidefront = 0; special = 200; arg0 = 3;
        arg1 = 8; arg3 = 2; playeruse = true; monsteractivate = true; }`,
    );
    expect(doom.lines.map((line) => line.special)).toEqual([
      0,
      23,
      0x6000 | 2 | (1 << 5) | (1 << 7),
    ]);
    expect(doom.udmf?.droppedFields).toEqual({
      "linedef.monsteractivate": 1,
    });
  });

  it("keep lines that block only players or walking monsters", () => {
    const [doom] = readMaps([
      udmfWad([
        "MAP01",
        room(
          "zdoom",
          `vertex { x = 96.0; y = 32.0; }
          vertex { x = 96.0; y = 224.0; }
          vertex { x = 160.0; y = 32.0; }
          vertex { x = 160.0; y = 224.0; }
          linedef { v1 = 4; v2 = 5; sidefront = 4; sideback = 5;
            twosided = true; blockplayers = true; }
          linedef { v1 = 6; v2 = 7; sidefront = 6; sideback = 7;
            twosided = true; blocklandmonsters = true; }
          sidedef { sector = 0; }
          sidedef { sector = 0; }
          sidedef { sector = 0; }
          sidedef { sector = 0; }`,
        ),
      ]),
    ]);
    expect(doom.udmf?.droppedFields).toEqual({});
    expect(doom.lines.map((line) => line.flags & 0x3000)).toEqual([
      0, 0, 0, 0, 0x2000, 0x1000,
    ]);
    const { map } = decompileMap(doom);
    expect(map.complevel).toBe("mbf21");
    expect(
      Object.values(map.lines ?? {}).filter(
        (line) => line.blocksPlayers || line.blocksWalkers,
      ),
    ).toEqual([{ blocksPlayers: true }, { blocksWalkers: true }]);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    const [built] = readMaps([{ name: "map.wad", data: compileMap(map) }]);
    expect(
      built.lines.map((line) => line.flags & 0x3000).filter(Boolean),
    ).toEqual([0x2000, 0x1000]);
  });

  it("count a generalized action as approximate when Boom can't say it all", () => {
    const [doom] = readMaps([
      udmfWad([
        "MAP01",
        room("zdoom").replace(
          "sidefront = 0; blocking = true;",
          "sidefront = 0; blocking = true; special = 205; arg0 = 3; arg1 = 16; arg2 = 16; arg4 = 10; playeruse = true;",
        ),
      ]),
    ]);
    const { report } = decompileMap(doom);
    expect(doom.lines[0].special).toBe(0x2f80 | 2 | (1 << 3));
    expect(report.droppedActions).toEqual({});
    expect(report.nearestActions).toEqual({ Generic_Crusher: 1 });
  });

  it("save and reload every sample map", () => {
    const classic = [starterMap, testMap].map(
      (source) => readMaps([{ name: "map.wad", data: compileMap(source) }])[0],
    );
    const wads = [
      udmfWad(
        ["MAP01", room("doom")],
        ["MAP02", room("woof")],
        ["MAP03", bigTagRoom],
        ["MAP04", doorAtLimit()],
        ...classic.map((doom, at): [string, string] => [
          `MAP1${at}`,
          toTextmap(doom),
        ]),
      ),
      ...["doom", "woof"].flatMap((namespace) =>
        [starterMap, testMap].map((source) => ({
          name: `${namespace}.wad`,
          data: packUdmfTestWad(source, { namespace }),
        })),
      ),
    ];
    for (const wad of wads) {
      for (const doom of readMaps([wad])) {
        const { map } = decompileMap(doom);
        expect(parseMapFile(serializeMap(map)), doom.slot).toEqual(map);
      }
    }
  });
});

const bigTagRoom = room("doom")
  .replace("heightceiling = 128;", "heightceiling = 128; id = 40000;")
  .replace(
    "v2 = 0; sidefront = 0;",
    "v2 = 0; sidefront = 0; special = 23; arg0 = 40000;",
  );

function doorAtLimit() {
  const out = ['namespace = "doom";'];
  const sides: string[] = [];
  for (const y of [0, 128]) {
    for (const x of [0, 256, 288, 544]) {
      out.push(`vertex { x = ${x}.0; y = ${y}.0; }`);
    }
  }
  const side = (sector: number, texture: string) =>
    sides.push(`sidedef { sector = ${sector}; ${texture} = "STARTAN3"; }`) - 1;
  const line = (v1: number, v2: number, front: number, back?: number) =>
    out.push(
      back === undefined
        ? `linedef { v1 = ${v1}; v2 = ${v2}; blocking = true; sidefront = ${side(front, "texturemiddle")}; }`
        : `linedef { v1 = ${v1}; v2 = ${v2}; twosided = true; special = 1; sidefront = ${side(front, "texturetop")}; sideback = ${side(back, "texturetop")}; }`,
    );
  line(0, 4, 0);
  line(7, 3, 2);
  for (const at of [0, 1, 2]) {
    line(4 + at, 5 + at, at);
    line(1 + at, at, at);
  }
  line(5, 1, 0, 1);
  line(2, 6, 2, 1);
  for (const ceiling of [32722, 32720, 32722]) {
    out.push(
      `sector { heightfloor = 32720; heightceiling = ${ceiling}; texturefloor = "FLOOR4_8"; textureceiling = "CEIL3_5"; }`,
    );
  }
  return [...out, ...sides].join("\n");
}

describe("TEXTMAP grammar", () => {
  const vertex = (body: string) =>
    readTextmap("MAP01", `namespace = "doom"; ${body}`).vertices;

  it("skips both kinds of comment, which don't nest", () => {
    expect(
      vertex(`// vertex { x = 9.0; y = 9.0; }
      vertex /* { x = 9.0; */ { x = 1.0; /* /* */ y = 2.0; } // end`),
    ).toEqual([{ x: 1, y: 2 }]);
    expect(() => vertex("vertex { x = 1.0; /* y = 2.0; }")).toThrow(
      /comment that never ends on line 1/,
    );
  });

  it("reads keys, block names and keywords in any case", () => {
    const doom = readTextmap(
      "MAP01",
      `Namespace = "DOOM"; VERTEX { X = 1.0; Y = 2.0; }
      LineDef { V1 = 0; v2 = 0; SideFront = -1; BLOCKING = True; }`,
    );
    expect(doom.udmf?.namespace).toBe("doom");
    expect(doom.vertices).toEqual([{ x: 1, y: 2 }]);
    expect(doom.lines[0]).toMatchObject({ flags: 1, front: null });
  });

  it("reads octal, hex, signed and exponent numbers", () => {
    expect(
      vertex(`vertex { x = 010; y = 0x1F; }
      vertex { x = -12; y = +3; }
      vertex { x = 0; y = 1.5e2; }
      vertex { x = 2.; y = -0.25; }`),
    ).toEqual([
      { x: 8, y: 31 },
      { x: -12, y: 3 },
      { x: 0, y: 150 },
      { x: 2, y: 0 },
    ]);
  });

  it("ends a value where a comment starts", () => {
    expect(vertex("vertex { x = 1.0/* a */; y = 2// b\n; }")).toEqual([
      { x: 1, y: 2 },
    ]);
  });

  it("rounds coordinates to whole units, as classic maps hold them", () => {
    expect(vertex("vertex { x = 64.5; y = -12.25; }")).toEqual([
      { x: 65, y: -12 },
    ]);
  });

  it("unescapes strings", () => {
    const doom = readTextmap(
      "MAP01",
      String.raw`namespace = "doom";
      sidedef { sector = 0; texturetop = "A\"B"; texturebottom = "C\\D"; }`,
    );
    expect(doom.sides[0]).toMatchObject({ upper: 'A"B', lower: "C\\D" });
  });

  it("refuses values of the wrong type, as the engine does", () => {
    for (const body of [
      'vertex { x = "400.000"; y = 0.0; }',
      "vertex { x = 400.0; y = -0x10; }",
      "linedef { v1 = 1.0; v2 = 0; sidefront = 0; }",
      "linedef { v1 = 0; v2 = 0; sidefront = 0; blocking = 1; }",
      "sidedef { sector = 0; texturemiddle = STARTAN3; }",
      "sidedef { sector = -1; }",
      "vertex { x = 40000.0; y = 0.0; }",
      'sector { heightceiling = 40000; texturefloor = "F"; }',
      "sidedef { sector = 0; offsetx = -40000; }",
      'sector { id = 70000; texturefloor = "F"; }',
      'sector { heightfloor = -32768; texturefloor = "F"; }',
      'sector { special = 40000; texturefloor = "F"; }',
      "linedef { v1 = 0; v2 = 0; sidefront = 0; special = -5; }",
    ]) {
      expect(() => vertex(body), body).toThrow(WadFileError);
    }
  });

  it("refuses broken structure with the line it's on", () => {
    expect(() => readTextmap("MAP01", "vertex { x = 0.0; y = 0.0; }")).toThrow(
      /doesn't name a namespace/,
    );
    expect(() => vertex("vertex { x = 0.0;\n y = 0.0 }")).toThrow(
      /expects ";" on line 2/,
    );
    expect(() => vertex("vertex { x = 0.0;")).toThrow(/never closes a vertex/);
    expect(() => vertex('vertex { x = "0.0; }')).toThrow(
      /string that never ends/,
    );
    expect(() => vertex("vertex { y = 0.0; }")).toThrow(/gives vertex 0 no x/);
    expect(() =>
      readMaps([udmfWad(["MAP07", 'namespace = "doom"; thing { x = 0.0; }'])]),
    ).toThrow(
      "MAP07 in udmf.wad can't be opened. Its TEXTMAP gives thing 0 no y.",
    );
  });
});

type Field = [string, string | number | boolean | undefined];

const lineFlags = [
  "blocking",
  "blockmonsters",
  "twosided",
  "dontpegtop",
  "dontpegbottom",
  "secret",
  "blocksound",
  "dontdraw",
  "mapped",
  "passuse",
];

// Writes a classic map's records as a TEXTMAP, the way Ultimate Doom Builder
// leaves out fields at their defaults. In zdoom, actions take their Hexen form.
function toTextmap(doom: DoomMap, namespace: "doom" | "zdoom" = "doom") {
  const out = [`namespace = "${namespace}";`];
  const block = (kind: string, fields: Field[]) => {
    out.push(`${kind}\n{`);
    for (const [name, value] of fields) {
      if (value === undefined || value === false) continue;
      out.push(`${name} = ${value};`);
    }
    out.push("}");
  };
  const texture = (name: string) =>
    name === "-" ? undefined : JSON.stringify(name);
  for (const thing of doom.things) {
    const has = (bit: number) => (thing.flags & bit) !== 0;
    block("thing", [
      ["x", thing.x.toFixed(3)],
      ["y", thing.y.toFixed(3)],
      ["angle", thing.angle],
      ["type", thing.type],
      ["skill1", has(0x0001)],
      ["skill2", has(0x0001)],
      ["skill3", has(0x0002)],
      ["skill4", has(0x0004)],
      ["skill5", has(0x0004)],
      ["ambush", has(0x0008)],
      ["single", !has(0x0010)],
      ["dm", !has(0x0020)],
      ["coop", !has(0x0040)],
      ["friend", has(0x0080)],
    ]);
  }
  for (const vertex of doom.vertices) {
    block("vertex", [
      ["x", vertex.x.toFixed(3)],
      ["y", vertex.y.toFixed(3)],
    ]);
  }
  for (const line of doom.lines) {
    block("linedef", [
      ...(namespace === "doom"
        ? ([
            ["id", line.tag || undefined],
            ["special", line.special || undefined],
            ["arg0", line.tag || undefined],
          ] satisfies Field[])
        : toHexenLine(line.special, line.tag)),
      ["v1", line.start],
      ["v2", line.end],
      ...lineFlags.map((name, bit): [string, boolean] => [
        name,
        (line.flags & (1 << bit)) !== 0,
      ]),
      ["sidefront", line.front ?? -1],
      ["sideback", line.back ?? undefined],
    ]);
  }
  for (const side of doom.sides) {
    block("sidedef", [
      ["offsetx", side.offsetX || undefined],
      ["offsety", side.offsetY || undefined],
      ["texturetop", texture(side.upper)],
      ["texturebottom", texture(side.lower)],
      ["texturemiddle", texture(side.middle)],
      ["sector", side.sector],
    ]);
  }
  for (const sector of doom.sectors) {
    block("sector", [
      ["heightfloor", sector.floor],
      ["heightceiling", sector.ceiling],
      ["texturefloor", texture(sector.floorTexture)],
      ["textureceiling", texture(sector.ceilingTexture)],
      ["lightlevel", sector.light],
      [
        "special",
        (namespace === "doom"
          ? sector.special
          : toHexenSector(sector.special)) || undefined,
      ],
      ["id", sector.tag || undefined],
    ]);
  }
  return out.join("\n");
}

const hexenTriggers = {
  walk: "playercross",
  use: "playeruse",
  shoot: "impact",
  "monster-walk": "monstercross",
};

function toHexenLine(special: number, tag: number): Field[] {
  if (special === 0) return [["id", tag || undefined]];
  const row = hexenTranslations.find(([doom]) => doom === special);
  if (!row) throw new Error(`No Hexen form for line special ${special}.`);
  const [, trigger, repeat, hexen, args] = row;
  return [
    ["special", hexen],
    ...args.map((arg, index): Field => {
      const value = arg === "tag" ? tag : (arg ?? 0);
      return [`arg${index}`, value || undefined];
    }),
    ...(trigger === "none"
      ? []
      : [[hexenTriggers[trigger], true] satisfies Field]),
    ["repeatspecial", repeat],
  ];
}

const hexenSectorTypes = [
  0, 65, 66, 67, 68, 69, -1, 71, 72, 0x400, 74, 75, 76, 77, 78, -1, 80, 81,
];

function toHexenSector(special: number) {
  const type = hexenSectorTypes[special & 0x1f] ?? -1;
  if (type < 0) throw new Error(`No Hexen form for sector special ${special}.`);
  return type | ((special & ~0x1f) << 3);
}
