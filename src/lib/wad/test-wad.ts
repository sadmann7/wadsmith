import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";

import { compileLumps } from "./compile";
import { readLumps } from "./inspect";
import { type DoomMap, readMaps } from "./read-map";
import { buildTextureWad, type IndexedImage } from "./resources";

export interface TestLump {
  name: string;
  data: Uint8Array;
}

const encode = (value: string) => new TextEncoder().encode(value);

// Packs lumps into a WAD the way the engine reads them, for tests that need
// one the compiler doesn't build.
export function packTestWad(lumps: TestLump[], magic = "PWAD") {
  const size = lumps.reduce((total, lump) => total + lump.data.length, 0);
  const wad = new Uint8Array(12 + size + lumps.length * 16);
  const view = new DataView(wad.buffer);
  wad.set(encode(magic));
  view.setInt32(4, lumps.length, true);
  view.setInt32(8, 12 + size, true);
  let offset = 12;
  lumps.forEach((lump, index) => {
    const entry = 12 + size + index * 16;
    wad.set(lump.data, offset);
    view.setInt32(entry, offset, true);
    view.setInt32(entry + 4, lump.data.length, true);
    wad.set(encode(lump.name), entry + 8);
    offset += lump.data.length;
  });
  return wad;
}

// A gray ramp, so a color's index is its brightness.
export const palette = Uint8Array.from({ length: 768 }, (_, index) =>
  Math.floor(index / 3),
);

// The least a WAD needs to stand in for a game: a palette, a colormap, a
// placeholder texture, one wall and one flat.
export function fakeIwad(more: { name: string; image: IndexedImage }[] = []) {
  const textures = buildTextureWad([
    { name: "AASHITTY", image: solid(8, 8, 1) },
    { name: "STARTAN3", image: solid(16, 32, 100) },
    { name: "FLOOR4_8", image: solid(64, 64, 50) },
    ...more,
  ]);
  return packTestWad(
    [
      { name: "PLAYPAL", data: palette },
      {
        name: "COLORMAP",
        data: Uint8Array.from({ length: 34 * 256 }, (_, index) => index % 256),
      },
      ...readLumps({ name: "textures.wad", data: textures }),
    ],
    "IWAD",
  );
}

export function solid(
  width: number,
  height: number,
  color: number,
): IndexedImage {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height).fill(color),
    opaque: new Uint8Array(width * height).fill(1),
  };
}

const classicParts = new Set([
  "THINGS",
  "LINEDEFS",
  "SIDEDEFS",
  "VERTEXES",
  "SEGS",
  "SSECTORS",
  "NODES",
  "SECTORS",
  "REJECT",
  "BLOCKMAP",
]);

interface UdmfTestWadOptions {
  namespace?: string;
  hasNodes?: boolean;
}

// Rewrites a compiled map as a UDMF map with only TEXTMAP and ZNODES, the
// way Ultimate Doom Builder saves one.
export function packUdmfTestWad(
  map: GameMap,
  { namespace = "woof", hasNodes = true }: UdmfTestWadOptions = {},
) {
  const lumps = compileLumps(map);
  const [doom] = readMaps([{ name: "map.wad", data: packTestWad(lumps) }]);
  const parts = new Map(lumps.map((lump) => [lump.name, lump.data]));
  return packTestWad([
    { name: "MAP01", data: new Uint8Array() },
    { name: "TEXTMAP", data: encode(writeTextmap(doom, namespace)) },
    ...(hasNodes ? [{ name: "ZNODES", data: classicNodesToXnod(parts) }] : []),
    { name: "BLOCKMAP", data: defined(parts.get("BLOCKMAP")) },
    { name: "REJECT", data: defined(parts.get("REJECT")) },
    { name: "ENDMAP", data: new Uint8Array() },
    ...lumps.filter(
      (lump) => lump.name !== "MAP01" && !classicParts.has(lump.name),
    ),
  ]);
}

const lineFlags: [string, number][] = [
  ["blocking", 0x0001],
  ["blockmonsters", 0x0002],
  ["twosided", 0x0004],
  ["dontpegtop", 0x0008],
  ["dontpegbottom", 0x0010],
  ["secret", 0x0020],
  ["blocksound", 0x0040],
  ["dontdraw", 0x0080],
  ["mapped", 0x0100],
  ["passuse", 0x0200],
];

function writeTextmap(doom: DoomMap, namespace: string) {
  const out = [`namespace = "${namespace}";`];
  const block = (
    kind: string,
    fields: [string, string | number | boolean][],
  ) => {
    out.push(`${kind} {`);
    for (const [name, value] of fields) {
      if (value === false) continue;
      out.push(`${name} = ${value};`);
    }
    out.push("}");
  };
  for (const thing of doom.things) {
    const has = (bit: number) => (thing.flags & bit) !== 0;
    block("thing", [
      ["x", thing.x.toFixed(1)],
      ["y", thing.y.toFixed(1)],
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
    ]);
  }
  for (const vertex of doom.vertices) {
    block("vertex", [
      ["x", vertex.x.toFixed(1)],
      ["y", vertex.y.toFixed(1)],
    ]);
  }
  for (const line of doom.lines) {
    block("linedef", [
      ["id", line.tag],
      ["v1", line.start],
      ["v2", line.end],
      ...lineFlags.map(([name, bit]): [string, boolean] => [
        name,
        (line.flags & bit) !== 0,
      ]),
      ["special", line.special],
      ["arg0", line.tag],
      ["sidefront", line.front ?? -1],
      ["sideback", line.back ?? -1],
    ]);
  }
  for (const side of doom.sides) {
    block("sidedef", [
      ["offsetx", side.offsetX],
      ["offsety", side.offsetY],
      ["texturetop", JSON.stringify(side.upper)],
      ["texturebottom", JSON.stringify(side.lower)],
      ["texturemiddle", JSON.stringify(side.middle)],
      ["sector", side.sector],
    ]);
  }
  for (const sector of doom.sectors) {
    block("sector", [
      ["heightfloor", sector.floor],
      ["heightceiling", sector.ceiling],
      ["texturefloor", JSON.stringify(sector.floorTexture)],
      ["textureceiling", JSON.stringify(sector.ceilingTexture)],
      ["lightlevel", sector.light],
      ["special", sector.special],
      ["id", sector.tag],
    ]);
  }
  return out.join("\n");
}

// XNOD keeps the classic tree and adds no vertices, since the builder makes
// no minisegs.
function classicNodesToXnod(lumps: Map<string, Uint8Array>) {
  const view = (name: string) => {
    const data = defined(lumps.get(name));
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  };
  const out: number[] = [];
  const u16 = (value: number) => out.push(value & 0xff, (value >>> 8) & 0xff);
  const u32 = (value: number) => {
    u16(value & 0xffff);
    u16(value >>> 16);
  };
  out.push(...encode("XNOD"));
  u32(view("VERTEXES").byteLength / 4);
  u32(0);
  const ssectors = view("SSECTORS");
  u32(ssectors.byteLength / 4);
  for (let at = 0; at < ssectors.byteLength; at += 4) {
    u32(ssectors.getUint16(at, true));
  }
  const segs = view("SEGS");
  u32(segs.byteLength / 12);
  for (let at = 0; at < segs.byteLength; at += 12) {
    u32(segs.getUint16(at, true));
    u32(segs.getUint16(at + 2, true));
    u16(segs.getUint16(at + 6, true));
    out.push(segs.getInt16(at + 8, true));
  }
  const nodes = view("NODES");
  u32(nodes.byteLength / 28);
  for (let at = 0; at < nodes.byteLength; at += 28) {
    for (let word = 0; word < 12; word += 1) {
      u16(nodes.getUint16(at + word * 2, true));
    }
    for (const child of [24, 26]) {
      const value = nodes.getUint16(at + child, true);
      u32(value & 0x8000 ? 0x80000000 | (value & 0x7fff) : value);
    }
  }
  return Uint8Array.from(out);
}
