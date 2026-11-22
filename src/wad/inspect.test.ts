import { describe, expect, it } from "vitest";

import { starterMap } from "@/map/starter-map";
import { compileLumps, compileMap } from "./compile";
import { WadFileError, inspectWads, readLumps } from "./inspect";
import { isZip, unzip } from "./zip";

type Lump = { name: string; data: Uint8Array };

const encode = (value: string) => new TextEncoder().encode(value);

function pack(lumps: Lump[], magic = "PWAD") {
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

function withLine(special: number, flags = 0) {
  const lumps = compileLumps(starterMap, "MAP03");
  const lines = lumps.find((lump) => lump.name === "LINEDEFS")!;
  const view = new DataView(lines.data.buffer, lines.data.byteOffset);
  view.setUint16(4, view.getUint16(4, true) | flags, true);
  view.setUint16(6, special, true);
  return pack(lumps);
}

function zipOf(files: { name: string; data: Uint8Array }[]) {
  const parts: Uint8Array[] = [];
  const entries: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encode(file.name);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint32(20, file.data.length, true);
    entryView.setUint32(24, file.data.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, file.data);
    entries.push(entry);
    offset += local.length + file.data.length;
  }
  const directory = entries.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directory, true);
  endView.setUint32(16, offset, true);
  const zip = new Uint8Array(offset + directory + 22);
  let at = 0;
  for (const part of [...parts, ...entries, end]) {
    zip.set(part, at);
    at += part.length;
  }
  return zip;
}

describe("inspectWads", () => {
  it("finds the maps of a vanilla WAD", () => {
    const summary = inspectWads([
      { name: "b.wad", data: compileMap(starterMap, "MAP02") },
      { name: "a.wad", data: compileMap(starterMap) },
    ]);
    expect(summary).toMatchObject({
      maps: [1, 2],
      complevel: "vanilla",
      declared: false,
    });
    expect(readLumps({ name: "a.wad", data: summary.wads[0] })[0].name).toBe(
      "MAP01",
    );
  });

  it("detects Boom, MBF and MBF21 maps", () => {
    const level = (data: Uint8Array) =>
      inspectWads([{ name: "map.wad", data }]).complevel;
    expect(level(withLine(242))).toBe("boom");
    expect(level(withLine(272))).toBe("mbf");
    expect(level(withLine(0, 0x1000))).toBe("mbf21");
    expect(level(withLine(1024))).toBe("mbf21");
  });

  it("ignores the junk flags old editors left on lines", () => {
    expect(
      inspectWads([{ name: "map.wad", data: withLine(0, 0xfe00) }]).complevel,
    ).toBe("vanilla");
  });

  it("reads the level from patches and lumps", () => {
    const map = { name: "map.wad", data: compileMap(starterMap) };
    const patch = (text: string) =>
      inspectWads([map, { name: "map.deh", data: encode(text) }]).complevel;
    expect(patch("Doom version = 21\nPatch format = 6\n")).toBe("vanilla");
    expect(patch("Doom version = 2021\n")).toBe("mbf21");
    expect(patch("[CODEPTR]\nFRAME 100 = Spawn\n")).toBe("mbf");
    expect(patch("[CODEPTR]\nFRAME 100 = SpawnFly\n")).toBe("boom");
    expect(patch("[CODEPTR]\nFRAME 100 = MonsterProjectile\n")).toBe("mbf21");
    expect(patch("[STRINGS]\nGOTARMOR = Armor\n")).toBe("boom");

    const animated = pack([
      ...compileLumps(starterMap),
      { name: "ANIMATED", data: new Uint8Array(1) },
    ]);
    expect(inspectWads([{ name: "a.wad", data: animated }]).complevel).toBe(
      "boom",
    );
  });

  it("follows a COMPLVL lump over what it detects", () => {
    const data = pack([
      { name: "COMPLVL", data: encode("vanilla\n") },
      ...compileLumps(starterMap),
    ]);
    expect(
      inspectWads([
        { name: "a.wad", data },
        { name: "b.wad", data: withLine(242) },
      ]),
    ).toMatchObject({ complevel: "vanilla", declared: true });
  });

  it("explains WADs it can't play", () => {
    const fails = (name: string, data: Uint8Array) => {
      try {
        inspectWads([{ name, data }]);
        return null;
      } catch (error) {
        expect(error).toBeInstanceOf(WadFileError);
        return (error as Error).message;
      }
    };
    expect(fails("notes.txt", encode("hello"))).toMatch(/isn't a WAD/);
    expect(
      fails("doom1.wad", pack([{ name: "E1M1", data: new Uint8Array() }])),
    ).toMatch(/Doom 1 maps/);
    expect(
      fails(
        "udmf.wad",
        pack([
          { name: "MAP01", data: new Uint8Array() },
          { name: "TEXTMAP", data: encode('namespace = "zdoom";') },
        ]),
      ),
    ).toMatch(/UDMF/);
    expect(fails("empty.wad", pack([]))).toMatch(/has a map/);
  });
});

describe("unzip", () => {
  it("takes the WADs and patches out of a zip", async () => {
    const wad = compileMap(starterMap);
    const zip = zipOf([
      { name: "readme.txt", data: encode("Read me") },
      { name: "pack/map.wad", data: wad },
      { name: "pack/map.deh", data: encode("Doom version = 21\n") },
      { name: "__MACOSX/pack/._map.wad", data: encode("metadata") },
    ]);
    expect(isZip(zip)).toBe(true);
    expect(isZip(wad)).toBe(false);
    const files = await unzip({ name: "pack.zip", data: zip });
    expect(files.map((file) => file.name)).toEqual(["map.wad", "map.deh"]);
    expect(files[0].data).toEqual(wad);
  });
});
