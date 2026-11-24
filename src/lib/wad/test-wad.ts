import { readLumps } from "./inspect";
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
