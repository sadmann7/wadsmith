import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { testMap } from "@/lib/map/test-map";

import { readWadAssets } from "./assets";
import { compileEpisode, compileMap } from "./compile";
import { readLumps } from "./inspect";
import {
  buildTextureWad,
  drawPatch,
  encodePatch,
  getHasTextures,
  type IndexedImage,
  lumpNameFor,
  quantizeImage,
  readTextureCatalog,
  readWadTextures,
  takenNames,
} from "./resources";
import { packTestWad } from "./test-wad";

// A gray ramp, so a color's index is its brightness.
const palette = Uint8Array.from({ length: 768 }, (_, index) =>
  Math.floor(index / 3),
);

describe("images as textures", () => {
  it("matches each pixel to the nearest color and leaves faint ones out", () => {
    const rgba = Uint8Array.from([
      10, 10, 10, 255, 201, 199, 200, 255, 90, 90, 90, 100, 255, 255, 255, 128,
    ]);
    const image = quantizeImage(rgba, 2, 2, palette);
    // Pixels are stored a column at a time.
    expect([...image.pixels]).toEqual([10, 0, 200, 255]);
    expect([...image.opaque]).toEqual([1, 0, 1, 1]);
  });

  it("stores a picture as a patch and draws the same picture back", () => {
    for (const [width, height] of [
      [4, 8],
      [3, 128],
      [2, 300],
      [2, 700],
    ]) {
      const image = blank(width, height);
      for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1) {
          // Holes of several lengths, a long solid run, and for the tallest a
          // start far below the last row a post can name outright.
          const hole =
            (height === 700 && y < 520) || (y % 37 < 5 && y % 2 === x % 2);
          if (hole) continue;
          image.pixels[x * height + y] = ((x * 31 + y * 7) % 250) + 1;
          image.opaque[x * height + y] = 1;
        }
      }
      const drawn = blank(width, height);
      drawPatch(encodePatch(image), drawn, 0, 0);
      expect([...drawn.opaque], `${width}x${height}`).toEqual([
        ...image.opaque,
      ]);
      expect([...drawn.pixels], `${width}x${height}`).toEqual([
        ...image.pixels,
      ]);
    }
  });

  it("packs images into a texture WAD, with a flat for each of a flat's size", () => {
    const wad = buildTextureWad([
      { name: "MYBRICK", image: solid(32, 64, 120) },
      { name: "MYFLOOR", image: solid(64, 64, 80) },
    ]);
    expect(getHasTextures(wad)).toBe(true);
    const textures = readWadTextures(wad);
    expect([...textures.definitions.keys()]).toEqual(["MYBRICK", "MYFLOOR"]);
    expect(textures.definitions.get("MYBRICK")).toEqual({
      name: "MYBRICK",
      width: 32,
      height: 64,
      patches: [{ name: "MYBRICK", x: 0, y: 0 }],
    });
    expect([...textures.flats.keys()]).toEqual(["MYFLOOR"]);
    expect(defined(textures.flats.get("MYFLOOR")).every((b) => b === 80)).toBe(
      true,
    );
    expect(getHasTextures(compileMap(testMap))).toBe(false);
  });

  it("names a lump after its file, cut to fit and kept apart", () => {
    const taken = new Set<string>();
    const name = (file: string) => {
      const lump = lumpNameFor(file, taken);
      taken.add(lump);
      return lump;
    };
    expect(name("brick wall.png")).toBe("BRICK_WA");
    expect(name("Brick Wall (2).PNG")).toBe("BRICK_W2");
    expect(name("textures/metal-01.png")).toBe("METAL-01");
    expect(name("???.png")).toBe("IMAGE");
    expect(name("???.png")).toBe("IMAGE2");
  });

  it("keeps an image off the names the engine and the game already use", () => {
    const iwad = fakeIwad();
    const pack = buildTextureWad([
      { name: "MYBRICK", image: solid(32, 64, 120) },
    ]);
    const taken = takenNames({ iwad, resources: [pack] });
    const name = (file: string) => lumpNameFor(file, taken);
    expect(name("startan3.png")).toBe("STARTAN2");
    expect(name("floor4_8.png")).toBe("FLOOR4_2");
    expect(name("mybrick.png")).toBe("MYBRICK2");
    expect(name("playpal.png")).toBe("PLAYPAL2");
    // No game here has a second texture lump, but the engine looks for one.
    expect(name("texture2.png")).toBe("TEXTURE3");
    expect(name("map07.png")).toBe("MAP072");
    expect(name("e1m1.png")).toBe("E1M12");
    expect(name("pp_start.png")).toBe("PP_STAR2");
    // A name that starts with a dash means no texture.
    expect(name("-dash-.png")).toBe("DASH-");
    // This game has no slime, and the engine expects all of it or none.
    expect(name("slime01.png")).toBe("SLIME012");
  });

  it("leaves out the first frame of an animation the game doesn't have", () => {
    const iwad = fakeIwad();
    const lone = buildTextureWad([
      { name: "SLIME01", image: solid(64, 64, 9) },
      { name: "BFALL1", image: solid(16, 32, 9) },
      { name: "MYFLOOR", image: solid(64, 64, 80) },
    ]);
    const assets = readWadAssets(iwad, [lone]);
    expect(assets.names.flats).toEqual(["FLOOR4_8", "MYFLOOR"]);
    expect(assets.names.textures).not.toContain("BFALL1");
    const whole = buildTextureWad([
      { name: "SLIME01", image: solid(64, 64, 9) },
      { name: "SLIME02", image: solid(64, 64, 10) },
      { name: "SLIME03", image: solid(64, 64, 11) },
      { name: "SLIME04", image: solid(64, 64, 12) },
    ]);
    expect(readWadAssets(iwad, [whole]).names.flats).toContain("SLIME01");
    const slimy: GameMap = {
      ...testMap,
      sectors: testMap.sectors.map((sector) => ({
        ...sector,
        floorTexture: "SLIME01",
      })),
    };
    const built = names(
      compileMap(slimy, "MAP01", {}, { iwad, resources: [whole] }),
    );
    expect(
      built.slice(built.indexOf("FF_START"), built.indexOf("FF_END") + 1),
    ).toEqual([
      "FF_START",
      "SLIME01",
      "SLIME02",
      "SLIME03",
      "SLIME04",
      "FF_END",
    ]);
  });

  it("leaves the game's palette alone when a resource has a patch of its name", () => {
    const iwad = fakeIwad();
    const odd = buildTextureWad([{ name: "PLAYPAL", image: solid(8, 8, 9) }]);
    expect([...readWadAssets(iwad, [odd]).shades]).toEqual([
      ...readWadAssets(iwad).shades,
    ]);
  });
});

function blank(width: number, height: number): IndexedImage {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height),
    opaque: new Uint8Array(width * height),
  };
}

describe("resources over the game's textures", () => {
  const iwad = fakeIwad();
  const pack = buildTextureWad([
    { name: "MYBRICK", image: solid(32, 64, 120) },
    { name: "MYFLOOR", image: solid(64, 64, 80) },
    // The same wall the game has, which isn't a change.
    { name: "STARTAN3", image: solid(16, 32, 100) },
  ]);

  it("adds a resource's textures to the game's and marks them as custom", () => {
    const alone = readWadAssets(iwad);
    expect(alone.names.textures).toEqual(["FLOOR4_8", "STARTAN3"]);
    expect(alone.names.custom).toEqual([]);
    expect(alone.texture("MYBRICK").width).toBe(1);

    const assets = readWadAssets(iwad, [pack]);
    expect(assets.names.textures).toEqual([
      "FLOOR4_8",
      "MYBRICK",
      "MYFLOOR",
      "STARTAN3",
    ]);
    expect(assets.names.flats).toEqual(["FLOOR4_8", "MYFLOOR"]);
    expect(assets.names.walls).toContain("MYBRICK");
    const brick = assets.texture("MYBRICK");
    expect([brick.width, brick.height]).toEqual([32, 64]);
    expect(brick.pixels.every((color) => color === 120)).toBe(true);
    expect(assets.flat("MYFLOOR").pixels.every((c) => c === 80)).toBe(true);
    // The placeholder can't be drawn, whichever WAD names it.
    expect(assets.texture("AASHITTY").width).toBe(1);

    const catalog = readTextureCatalog({ iwad, resources: [pack] });
    expect([...catalog.customTextures].toSorted()).toEqual([
      "MYBRICK",
      "MYFLOOR",
    ]);
    expect([...catalog.customFlats]).toEqual(["MYFLOOR"]);
    expect(catalog.placeholder).toBe("AASHITTY");
  });

  it("builds a WAD with only the custom textures its maps use", () => {
    const source = { iwad, resources: [pack] };
    const custom: GameMap = {
      ...testMap,
      sectors: testMap.sectors.map((sector, index) =>
        index === 0
          ? { ...sector, wallTexture: "MYBRICK", floorTexture: "MYFLOOR" }
          : sector,
      ),
    };
    const plain = names(compileMap(testMap, "MAP01", {}, source));
    expect(plain).toEqual(names(compileMap(testMap)));

    const built = compileMap(custom, "MAP01", {}, source);
    const added = names(built).filter(
      (name) => !names(compileMap(custom)).includes(name),
    );
    expect(added).toEqual([
      "PNAMES",
      "TEXTURE1",
      "PP_START",
      "MYBRICK",
      "PP_END",
      "FF_START",
      "MYFLOOR",
      "FF_END",
    ]);
    const textures = readWadTextures(built);
    // The game's own list comes first and whole, since the lump replaces it.
    expect(textures.first.map((definition) => definition.name)).toEqual([
      "AASHITTY",
      "STARTAN3",
      "FLOOR4_8",
      "MYBRICK",
    ]);
    expect(textures.patchNames).toEqual([
      "AASHITTY",
      "STARTAN3",
      "FLOOR4_8",
      "MYBRICK",
    ]);
    // Read over the game the way the engine would, the wall is the same.
    const played = readWadAssets(iwad, [built]);
    expect(played.texture("MYBRICK").pixels.every((c) => c === 120)).toBe(true);
    expect(played.texture("STARTAN3").pixels.every((c) => c === 100)).toBe(
      true,
    );
    expect(played.flat("MYFLOOR").pixels.every((c) => c === 80)).toBe(true);
  });

  it("carries a custom sky and every map's textures in an episode", () => {
    const source = { iwad, resources: [pack] };
    const sky = names(compileMap(testMap, "MAP01", { sky: "MYBRICK" }, source));
    expect(sky).toContain("MYBRICK");
    const episode = compileEpisode(
      [
        { slot: "MAP01", map: testMap },
        {
          slot: "MAP02",
          map: {
            ...testMap,
            sectors: testMap.sectors.map((sector) => ({
              ...sector,
              ceilingTexture: "MYFLOOR",
            })),
          },
        },
      ],
      undefined,
      source,
    );
    expect(names(episode).filter((name) => name === "MYFLOOR")).toHaveLength(1);
    expect(names(episode)).not.toContain("TEXTURE1");
  });

  it("lets a resource replace one of the game's textures", () => {
    const repaint = buildTextureWad([
      { name: "STARTAN3", image: solid(16, 32, 222) },
    ]);
    const source = { iwad, resources: [repaint] };
    const assets = readWadAssets(iwad, [repaint]);
    expect(assets.texture("STARTAN3").pixels.every((c) => c === 222)).toBe(
      true,
    );
    // The definition is the game's own, so only the patch has to travel.
    const built = compileMap(testMap, "MAP01", {}, source);
    const added = names(built).filter(
      (name) => !names(compileMap(testMap)).includes(name),
    );
    expect(added).toEqual(["PP_START", "STARTAN3", "PP_END"]);
  });
});

describe("animations and switches", () => {
  const iwad = fakeIwad([
    { name: "SLADRIP1", image: solid(16, 32, 71) },
    { name: "SLADRIP2", image: solid(16, 32, 72) },
    { name: "SLADRIP3", image: solid(16, 32, 73) },
    { name: "SW1BRIK", image: solid(16, 32, 81) },
    { name: "SW2BRIK", image: solid(16, 32, 82) },
    { name: "NUKAGE1", image: solid(64, 64, 61) },
    { name: "NUKAGE2", image: solid(64, 64, 62) },
    { name: "NUKAGE3", image: solid(64, 64, 63) },
  ]);
  const paint = (change: Partial<GameMap["sectors"][number]>): GameMap => ({
    ...testMap,
    sectors: testMap.sectors.map((sector, index) =>
      index === 0 ? { ...sector, ...change } : sector,
    ),
  });
  const flatsOf = (wad: Uint8Array) => {
    const order = names(wad);
    return order.slice(order.indexOf("FF_START"), order.indexOf("FF_END") + 1);
  };

  it("takes the rest of an animated flat along, the game's frames included", () => {
    const source = {
      iwad,
      resources: [
        buildTextureWad([{ name: "NUKAGE2", image: solid(64, 64, 200) }]),
      ],
    };
    // The engine numbers a WAD's flats after the game's, and an animation
    // runs from its first frame to its last by number.
    for (const floor of ["NUKAGE1", "NUKAGE2"]) {
      const built = compileMap(
        paint({ floorTexture: floor }),
        "MAP01",
        {},
        source,
      );
      expect(flatsOf(built), floor).toEqual([
        "FF_START",
        "NUKAGE1",
        "NUKAGE2",
        "NUKAGE3",
        "FF_END",
      ]);
      const { flats } = readWadTextures(built);
      expect(
        ["NUKAGE1", "NUKAGE2", "NUKAGE3"].map(
          (name) => defined(flats.get(name))[0],
        ),
      ).toEqual([61, 200, 63]);
    }
    expect(names(compileMap(testMap, "MAP01", {}, source))).not.toContain(
      "FF_START",
    );
  });

  it("keeps an animated flat's frames together and ahead of the other flats", () => {
    const source = {
      iwad,
      resources: [
        buildTextureWad([
          { name: "AAFLOOR", image: solid(64, 64, 90) },
          { name: "NUKAGE2B", image: solid(64, 64, 91) },
          { name: "NUKAGE1", image: solid(64, 64, 201) },
          { name: "NUKAGE2", image: solid(64, 64, 202) },
          { name: "NUKAGE3", image: solid(64, 64, 203) },
        ]),
      ],
    };
    const built = compileEpisode(
      [
        { slot: "MAP01", map: paint({ floorTexture: "NUKAGE3" }) },
        {
          slot: "MAP02",
          map: paint({ floorTexture: "AAFLOOR", ceilingTexture: "NUKAGE2B" }),
        },
      ],
      undefined,
      source,
    );
    expect(flatsOf(built)).toEqual([
      "FF_START",
      "NUKAGE1",
      "NUKAGE2",
      "NUKAGE3",
      "AAFLOOR",
      "NUKAGE2B",
      "FF_END",
    ]);
  });

  it("carries every frame of an animated wall and both faces of a switch", () => {
    const source = {
      iwad,
      resources: [
        buildTextureWad([
          { name: "SLADRIP1", image: solid(24, 32, 171) },
          { name: "SLADRIP2", image: solid(24, 32, 172) },
          { name: "SLADRIP3", image: solid(24, 32, 173) },
          { name: "SW1BRIK", image: solid(16, 32, 181) },
          { name: "SW2BRIK", image: solid(16, 32, 182) },
        ]),
      ],
    };
    const built = compileEpisode(
      [
        { slot: "MAP01", map: paint({ wallTexture: "SLADRIP2" }) },
        { slot: "MAP02", map: paint({ wallTexture: "SW2BRIK" }) },
      ],
      undefined,
      source,
    );
    const played = readWadAssets(iwad, [built]);
    expect(
      ["SLADRIP1", "SLADRIP2", "SLADRIP3", "SW1BRIK", "SW2BRIK"].map(
        (name) => played.texture(name).pixels[0],
      ),
    ).toEqual([171, 172, 173, 181, 182]);
    expect(played.texture("SLADRIP3").width).toBe(24);
    // The frames keep the game's order, which is what the engine runs through.
    expect(readWadTextures(built).first.map((item) => item.name)).toEqual(
      readWadTextures(iwad).first.map((item) => item.name),
    );
  });

  it("changes a texture of the game's second list in place", () => {
    const base = readLumps({ name: "iwad.wad", data: iwad });
    const all = readWadTextures(iwad).first;
    const lump = (list: typeof all) => {
      const data = new Uint8Array(4 + list.length * 36);
      const view = new DataView(data.buffer);
      view.setInt32(0, list.length, true);
      list.forEach((item, index) => {
        const at = 4 + list.length * 4 + index * 32;
        view.setInt32(4 + index * 4, at, true);
        data.set(new TextEncoder().encode(item.name), at);
        view.setInt16(at + 12, item.width, true);
        view.setInt16(at + 14, item.height, true);
        view.setInt16(at + 20, 1, true);
        view.setInt16(at + 26, all.indexOf(item), true);
      });
      return data;
    };
    // Doom keeps the textures of its later episodes in a second lump.
    const doom = packTestWad(
      base.flatMap((item) =>
        item.name === "TEXTURE1"
          ? [
              { name: "TEXTURE1", data: lump(all.slice(0, 4)) },
              { name: "TEXTURE2", data: lump(all.slice(4)) },
            ]
          : [item],
      ),
      "IWAD",
    );
    expect(readWadTextures(doom).second.map((item) => item.name)).toEqual(
      all.slice(4).map((item) => item.name),
    );
    const source = {
      iwad: doom,
      resources: [
        buildTextureWad([{ name: "SW1BRIK", image: solid(24, 48, 181) }]),
      ],
    };
    const built = compileMap(
      paint({ wallTexture: "SW1BRIK" }),
      "MAP01",
      {},
      source,
    );
    const textures = readWadTextures(built);
    expect(textures.first.map((item) => item.name)).toEqual(
      all.slice(0, 4).map((item) => item.name),
    );
    expect(textures.second.map((item) => item.name)).toEqual(
      all.slice(4).map((item) => item.name),
    );
    const changed = defined(textures.definitions.get("SW1BRIK"));
    expect([changed.width, changed.height]).toEqual([24, 48]);
    expect(readWadAssets(doom, [built]).texture("SW2BRIK").pixels[0]).toBe(82);
  });
});

// The least a WAD needs to stand in for a game: a palette, a colormap, a
// placeholder texture, one wall and one flat.
function fakeIwad(more: { name: string; image: IndexedImage }[] = []) {
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

function names(wad: Uint8Array) {
  return readLumps({ name: "built.wad", data: wad }).map((lump) => lump.name);
}

function solid(width: number, height: number, color: number): IndexedImage {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height).fill(color),
    opaque: new Uint8Array(width * height).fill(1),
  };
}
