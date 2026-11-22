import { thingCatalog, thingKinds } from "@/map/catalog";
import type { ThingKind } from "@/map/types";

interface Picture {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  pixels: Uint8Array;
  opaque: Uint8Array;
}

interface SceneAssets {
  shades: Uint32Array;
  texture: (name: string) => Picture;
  flat: (name: string) => Picture;
  sprite: (kind: ThingKind) => Picture | null;
}

interface Lump {
  offset: number;
  size: number;
}

const shadeLevels = 32;
const flatSize = 64;

// A sprite's name and frame, matched to its first lump facing front.
const spriteFrames: Record<ThingKind, string | null> = {
  player: "PLAYA",
  "player-2": "PLAYA",
  "player-3": "PLAYA",
  "player-4": "PLAYA",
  "deathmatch-start": "PLAYA",
  imp: "TROOA",
  zombieman: "POSSA",
  "shotgun-guy": "SPOSA",
  demon: "SARGA",
  spectre: "SARGA",
  "lost-soul": "SKULA",
  chaingunner: "CPOSA",
  "pain-elemental": "PAINA",
  shotgun: "SHOTA",
  chaingun: "MGUNA",
  clip: "CLIPA",
  shells: "SHELA",
  stimpack: "STIMA",
  medikit: "MEDIA",
  "green-armor": "ARM1A",
  "blue-armor": "ARM2A",
  "blue-key": "BKEYA",
  "yellow-key": "YKEYA",
  "red-key": "RKEYA",
  barrel: "BAR1A",
  lamp: "COLUA",
  "tech-column": "ELECA",
  "red-torch": "TREDA",
  cacodemon: "HEADA",
  "hell-knight": "BOS2A",
  "baron-of-hell": "BOSSA",
  arachnotron: "BSPIA",
  revenant: "SKELA",
  mancubus: "FATTA",
  "arch-vile": "VILEA",
  "spider-mastermind": "SPIDA",
  cyberdemon: "CYBRA",
  "wolfenstein-ss": "SSWVA",
  "commander-keen": "KEENA",
  "boss-brain": "BBRNA",
  chainsaw: "CSAWA",
  "super-shotgun": "SGN2A",
  "rocket-launcher": "LAUNA",
  "plasma-gun": "PLASA",
  "bfg-9000": "BFUGA",
  "box-of-bullets": "AMMOA",
  "box-of-shells": "SBOXA",
  rocket: "ROCKA",
  "box-of-rockets": "BROKA",
  cell: "CELLA",
  "cell-pack": "CELPA",
  backpack: "BPAKA",
  "health-bonus": "BON1A",
  soulsphere: "SOULA",
  megasphere: "MEGAA",
  "armor-bonus": "BON2A",
  invulnerability: "PINVA",
  berserk: "PSTRA",
  "partial-invisibility": "PINSA",
  "radiation-suit": "SUITA",
  "computer-map": "PMAPA",
  "light-amplification": "PVISA",
  "blue-skull-key": "BSKUA",
  "yellow-skull-key": "YSKUA",
  "red-skull-key": "RSKUA",
  "burning-barrel": "FCANA",
  "tall-tech-lamp": "TLMPA",
  "short-tech-lamp": "TLP2A",
  candle: "CANDA",
  candelabra: "CBRAA",
  "tall-blue-torch": "TBLUA",
  "tall-green-torch": "TGRNA",
  "short-blue-torch": "SMBTA",
  "short-green-torch": "SMGTA",
  "short-red-torch": "SMRTA",
  "tall-green-pillar": "COL1A",
  "short-green-pillar": "COL2A",
  "tall-red-pillar": "COL3A",
  "short-red-pillar": "COL4A",
  "heart-pillar": "COL5A",
  "skull-pillar": "COL6A",
  "brown-stump": "SMITA",
  "burnt-tree": "TRE1A",
  "big-tree": "TRE2A",
  "evil-eye": "CEYEA",
  "floating-skulls": "FSKUA",
  "bloody-mess": "PLAYW",
  "bloody-mess-2": "PLAYW",
  "dead-player": "PLAYN",
  "dead-zombieman": "POSSL",
  "dead-shotgun-guy": "SPOSL",
  "dead-imp": "TROOM",
  "dead-demon": "SARGN",
  "dead-cacodemon": "HEADL",
  "dead-lost-soul": null,
  "pool-of-blood": "POB1A",
  "impaled-human": "POL1A",
  "twitching-impaled-human": "POL6A",
  "skull-on-pole": "POL4A",
  "skulls-on-pole": "POL2A",
  "pile-of-skulls": "POL3A",
  "hanging-victim-twitching": "GOR1A",
  "hanging-victim-arms-out": "GOR2A",
  "hanging-victim-one-leg": "GOR3A",
  "hanging-legs": "GOR4A",
  "hanging-leg": "GOR5A",
  "hanging-victim-arms-out-2": "GOR2A",
  "hanging-legs-2": "GOR4A",
  "hanging-victim-one-leg-2": "GOR3A",
  "hanging-leg-2": "GOR5A",
  "hanging-victim-twitching-2": "GOR1A",
  "hanging-victim-guts": "HDB1A",
  "hanging-victim-guts-brain": "HDB2A",
  "hanging-torso-looking-down": "HDB3A",
  "hanging-torso-open-skull": "HDB4A",
  "hanging-torso-looking-up": "HDB5A",
  "hanging-torso-brain-removed": "HDB6A",
  "pool-of-blood-and-flesh": "POL5A",
  "pool-of-blood-2": "POB2A",
  "pool-of-brains": "BRS1A",
  "boss-shooter": null,
  "spawn-spot": null,
  "teleport-destination": null,
};

function lightStart(light: number, contrast: number) {
  const band = Math.max(0, Math.min(15, (light >> 4) + contrast));
  return (15 - band) * 4;
}

function clampShade(level: number) {
  return Math.max(0, Math.min(shadeLevels - 1, level));
}

// These follow the engine's scalelight and zlight tables for a 320-wide view.
function gameWallShade(light: number, distance = 160, contrast = 0) {
  const scale = Math.min(47, Math.floor((16 * 160) / distance));
  return clampShade(lightStart(light, contrast) - (scale >> 1));
}

function gameFlatShade(light: number, distance: number) {
  const band = Math.min(127, Math.floor(distance / 16));
  return clampShade(lightStart(light, 0) - (Math.floor(160 / (band + 1)) >> 1));
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

// Monster lumps can hold two frames in one name, like BSPIA1D1.
function spriteLump(lumps: Map<string, Lump>, frame: string) {
  for (const [name, lump] of lumps) {
    if (name.length < 6) continue;
    if (name.startsWith(frame) && "01".includes(name[5])) return lump;
    if (
      name.length === 8 &&
      name.startsWith(frame.slice(0, 4)) &&
      name[6] === frame[4] &&
      "01".includes(name[7])
    ) {
      return lump;
    }
  }
  return undefined;
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
      const frame = spriteFrames[kind];
      const lump = frame === null ? undefined : spriteLump(lumps, frame);
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
  const hexIndexes = new Map<string, number>();
  for (const kind of thingKinds) {
    const hex = thingCatalog[kind].color;
    if (!hexIndexes.has(hex)) {
      hexIndexes.set(hex, colors.length);
      colors.push([
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
      ]);
    }
    thingIndexes.set(kind, hexIndexes.get(hex)!);
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
      const monster =
        thingCatalog[kind].category === "enemy" ||
        thingCatalog[kind].category === "start";
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
  gameFlatShade,
  gameWallShade,
  readWadAssets,
  shadeLevels,
  type Picture,
  type SceneAssets,
};
