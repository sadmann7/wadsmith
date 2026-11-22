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
