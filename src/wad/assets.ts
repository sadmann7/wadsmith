import { thingCatalog, thingKinds } from "../map/catalog";
import type { ThingKind } from "../map/types";

type Picture = {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  pixels: Uint8Array;
  opaque: Uint8Array;
};

type SceneAssets = {
  shades: Uint32Array;
  texture: (name: string) => Picture;
  flat: (name: string) => Picture;
  sprite: (kind: ThingKind) => Picture | null;
};

type Lump = { offset: number; size: number };

const shadeLevels = 32;
const flatSize = 64;

const spriteLumps: Record<ThingKind, string> = {
  player: "PLAYA1",
  zombieman: "POSSA1",
  "shotgun-guy": "SPOSA1",
  imp: "TROOA1",
  demon: "SARGA1",
  shotgun: "SHOTA0",
  shells: "SBOXA0",
  medikit: "MEDIA0",
  "blue-key": "BKEYA0",
  "yellow-key": "YKEYA0",
  "red-key": "RKEYA0",
};

// The engine's colormap for a wall drawn at one texel per screen pixel.
function gameWallShade(light: number) {
  const level = (15 - (light >> 4)) * 4 - 8;
  return Math.max(0, Math.min(shadeLevels - 1, level));
}

function createPicture(width: number, height: number): Picture {
  return {
    width,
    height,
    leftOffset: 0,
    topOffset: 0,
    pixels: new Uint8Array(width * height),
    opaque: new Uint8Array(width * height),
  };
}

function solidPicture(width: number, height: number, color: number) {
  const picture = createPicture(width, height);
  picture.pixels.fill(color);
  picture.opaque.fill(1);
  return picture;
}

function packColor(red: number, green: number, blue: number) {
  return ((255 << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}

function readName(bytes: Uint8Array, offset: number) {
  let name = "";
  for (let index = 0; index < 8 && bytes[offset + index]; index += 1) {
    name += String.fromCharCode(bytes[offset + index]);
  }
  return name.toUpperCase();
}

function readWadAssets(bytes: Uint8Array): SceneAssets {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lumps = new Map<string, Lump>();
  const flats = new Map<string, Lump>();
  const count = view.getInt32(4, true);
  const directory = view.getInt32(8, true);
  let inFlats = false;
  for (let index = 0; index < count; index += 1) {
    const entry = directory + index * 16;
    const name = readName(bytes, entry + 8);
    const lump = {
      offset: view.getInt32(entry, true),
      size: view.getInt32(entry + 4, true),
    };
    if (name === "F_START") inFlats = true;
    else if (name === "F_END") inFlats = false;
    else if (inFlats && lump.size === flatSize * flatSize) {
      flats.set(name, lump);
    }
    lumps.set(name, lump);
  }

  const required = (name: string) => {
    const lump = lumps.get(name);
    if (!lump) throw new Error(`The WAD has no ${name} lump.`);
    return lump;
  };

  const palette = required("PLAYPAL").offset;
  const colormap = required("COLORMAP").offset;
  const shades = new Uint32Array(shadeLevels * 256);
  for (let level = 0; level < shadeLevels; level += 1) {
    for (let color = 0; color < 256; color += 1) {
      const mapped = bytes[colormap + level * 256 + color] * 3;
      shades[level * 256 + color] = packColor(
        bytes[palette + mapped],
        bytes[palette + mapped + 1],
        bytes[palette + mapped + 2],
      );
    }
  }

  const drawPatch = (
    lump: Lump,
    target: Picture,
    originX: number,
    originY: number,
  ) => {
    const start = lump.offset;
    const width = view.getInt16(start, true);
    for (let column = 0; column < width; column += 1) {
      const x = originX + column;
      let post = start + view.getInt32(start + 8 + column * 4, true);
      while (bytes[post] !== 0xff) {
        const top = bytes[post];
        const length = bytes[post + 1];
        for (let row = 0; row < length; row += 1) {
          const y = originY + top + row;
          if (x >= 0 && x < target.width && y >= 0 && y < target.height) {
            const index = x * target.height + y;
            target.pixels[index] = bytes[post + 3 + row];
            target.opaque[index] = 1;
          }
        }
        post += length + 4;
      }
    }
  };

  const patchLump = required("PNAMES").offset;
  const patchNames = Array.from(
    { length: view.getInt32(patchLump, true) },
    (_, index) => readName(bytes, patchLump + 4 + index * 8),
  );
  const definitions = new Map<string, number>();
  for (const name of ["TEXTURE1", "TEXTURE2"]) {
    const lump = lumps.get(name);
    if (!lump) continue;
    const total = view.getInt32(lump.offset, true);
    for (let index = 0; index < total; index += 1) {
      const entry =
        lump.offset + view.getInt32(lump.offset + 4 + index * 4, true);
      definitions.set(readName(bytes, entry), entry);
    }
  }

  const missing = solidPicture(1, 1, 0);
  const textureCache = new Map<string, Picture>();
  const flatCache = new Map<string, Picture>();
  const spriteCache = new Map<ThingKind, Picture | null>();

  return {
    shades,
    texture(name) {
      const cached = textureCache.get(name);
      if (cached) return cached;
      const entry = definitions.get(name);
      if (entry === undefined) return missing;
      const picture = createPicture(
        view.getInt16(entry + 12, true),
        view.getInt16(entry + 14, true),
      );
      const patches = view.getInt16(entry + 20, true);
      for (let index = 0; index < patches; index += 1) {
        const patch = entry + 22 + index * 10;
        const lump = lumps.get(patchNames[view.getInt16(patch + 4, true)]);
        if (lump) {
          drawPatch(
            lump,
            picture,
            view.getInt16(patch, true),
            view.getInt16(patch + 2, true),
          );
        }
      }
      textureCache.set(name, picture);
      return picture;
    },
    flat(name) {
      const cached = flatCache.get(name);
      if (cached) return cached;
      const lump = flats.get(name);
      if (!lump) return missing;
      const picture = createPicture(flatSize, flatSize);
      picture.opaque.fill(1);
      for (let x = 0; x < flatSize; x += 1) {
        for (let y = 0; y < flatSize; y += 1) {
          picture.pixels[x * flatSize + y] =
            bytes[lump.offset + y * flatSize + x];
        }
      }
      flatCache.set(name, picture);
      return picture;
    },
    sprite(kind) {
      const cached = spriteCache.get(kind);
      if (cached !== undefined) return cached;
      const lump = lumps.get(spriteLumps[kind]);
      let picture: Picture | null = null;
      if (lump) {
        picture = createPicture(
          view.getInt16(lump.offset, true),
          view.getInt16(lump.offset + 2, true),
        );
        picture.leftOffset = view.getInt16(lump.offset + 4, true);
        picture.topOffset = view.getInt16(lump.offset + 6, true);
        drawPatch(lump, picture, 0, 0);
      }
      spriteCache.set(kind, picture);
      return picture;
    },
  };
}

const flatColors: Record<string, readonly [number, number, number]> = {
  STARTAN3: [130, 118, 102],
  BROWN1: [120, 88, 60],
  GRAY1: [118, 118, 118],
  METAL: [86, 98, 108],
  STONE2: [104, 100, 92],
  BRICK1: [134, 76, 60],
  TEKGREN2: [62, 112, 86],
  SLADWALL: [84, 92, 84],
  FLOOR4_8: [78, 74, 70],
  FLOOR0_1: [96, 84, 70],
  FLOOR5_1: [84, 70, 58],
  FLAT1: [104, 104, 104],
  FLAT5_4: [92, 88, 80],
  GRASS1: [62, 96, 52],
  RROCK01: [90, 66, 50],
  CEIL3_5: [88, 84, 78],
  CEIL5_1: [70, 72, 76],
  CEIL1_1: [100, 96, 88],
  TLITE6_4: [176, 170, 150],
  BIGDOOR2: [120, 124, 130],
  BIGDOOR4: [128, 110, 90],
  DOOR1: [116, 118, 122],
  DOOR3: [134, 126, 104],
  DOORTRAK: [72, 74, 78],
  SW1STRTN: [92, 176, 112],
  SW1GRAY: [92, 176, 112],
  SW1METAL: [92, 176, 112],
  SW1STON1: [92, 176, 112],
  SW1COMP: [92, 176, 112],
};

// Stands in for the WAD while it loads, or if it can't be loaded at all.
function createFlatAssets(): SceneAssets {
  const colors: (readonly [number, number, number])[] = [[120, 120, 120]];
  const indexes = new Map<string, number>();
  for (const [name, color] of Object.entries(flatColors)) {
    indexes.set(name, colors.length);
    colors.push(color);
  }
  const thingIndexes = new Map<ThingKind, number>();
  for (const kind of thingKinds) {
    const hex = thingCatalog[kind].color;
    thingIndexes.set(kind, colors.length);
    colors.push([
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ]);
  }

  const shades = new Uint32Array(shadeLevels * 256);
  for (let level = 0; level < shadeLevels; level += 1) {
    const light = 1 - level / shadeLevels;
    colors.forEach(([red, green, blue], color) => {
      shades[level * 256 + color] = packColor(
        red * light,
        green * light,
        blue * light,
      );
    });
  }

  const tile = (name: string) => solidPicture(1, 1, indexes.get(name) ?? 0);
  return {
    shades,
    texture: tile,
    flat: tile,
    sprite(kind) {
      const monster = thingCatalog[kind].monster || kind === "player";
      const picture = solidPicture(
        monster ? 36 : 22,
        monster ? 56 : 20,
        thingIndexes.get(kind) ?? 0,
      );
      picture.leftOffset = picture.width / 2;
      picture.topOffset = picture.height;
      return picture;
    },
  };
}

export {
  createFlatAssets,
  gameWallShade,
  readWadAssets,
  shadeLevels,
  type Picture,
  type SceneAssets,
};
