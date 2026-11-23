import type { TextureNames } from "@/lib/map/textures";
import type { ThingKind } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import {
  doorTextures,
  switchTextures,
  thingCatalog,
  thingKinds,
} from "@/lib/map/catalog";
import {
  freedoomFlats,
  freedoomWalls,
  middleTextures,
} from "@/lib/map/freedoom-textures";

import { resourceSprites } from "./custom-things";
import {
  drawPatch,
  flatSize,
  readTextureCatalog,
  type TextureDefinition,
} from "./resources";

export interface Picture {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  pixels: Uint8Array;
  opaque: Uint8Array;
}

export interface SceneAssets {
  shades: Uint32Array;
  names: TextureNames;
  texture: (name: string) => Picture;
  flat: (name: string) => Picture;
  sprite: (kind: ThingKind) => Picture | null;
  // A sprite by its name and frame, like "TROOA", facing front.
  frame: (name: string) => Picture | null;
}

export const shadeLevels = 32;

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
  custom: null,
};

// These follow the engine's scalelight and zlight tables for a 320-wide view.
export function gameWallShade(light: number, distance = 160, contrast = 0) {
  const scale = Math.min(47, Math.floor((16 * 160) / distance));
  return clampShade(lightStart(light, contrast) - (scale >> 1));
}

export function gameFlatShade(light: number, distance: number) {
  const band = Math.min(127, Math.floor(distance / 16));
  return clampShade(lightStart(light, 0) - (Math.floor(160 / (band + 1)) >> 1));
}

// Resources lay their textures and flats over the game's, a later one over
// an earlier one.
export function readWadAssets(
  iwad: Uint8Array,
  resources: Uint8Array[] = [],
): SceneAssets {
  const catalog = readTextureCatalog({ iwad, resources });
  const { definitions, flats, lumps } = catalog;
  // A mod's sprites come after the game's, as the engine loads them.
  const spriteLumps = new Map([...lumps, ...resourceSprites(resources)]);

  const required = (name: string) => {
    const lump = lumps.get(name);
    if (!lump) throw new Error(`The WAD has no ${name} lump.`);
    return lump;
  };

  const palette = required("PLAYPAL");
  const colormap = required("COLORMAP");
  const shades = new Uint32Array(shadeLevels * 256);
  for (let level = 0; level < shadeLevels; level += 1) {
    for (let color = 0; color < 256; color += 1) {
      const mapped = colormap[level * 256 + color] * 3;
      shades[level * 256 + color] = packColor(
        palette[mapped],
        palette[mapped + 1],
        palette[mapped + 2],
      );
    }
  }

  const missing = solidPicture(1, 1, 0);
  const textureCache = new Map<string, Picture>();
  const flatCache = new Map<string, Picture>();
  const spriteCache = new Map<string, Picture | null>();

  const compose = (definition: TextureDefinition) => {
    const picture = createPicture(definition.width, definition.height);
    for (const patch of definition.patches) {
      const lump = lumps.get(patch.name);
      if (lump) drawPatch(lump, picture, patch.x, patch.y);
    }
    return picture;
  };

  const all = [...definitions.keys()]
    .filter((name) => name !== catalog.placeholder)
    .toSorted();
  const flatNames = [...flats.keys()].toSorted();
  // A texture with a hole in it shows through, so it suits an open line and
  // not a solid wall. Telling them apart means drawing each one once.
  let sorted: { walls: string[]; middles: string[] } | null = null;
  const sort = () => {
    if (sorted) return sorted;
    const walls: string[] = [];
    const holed: string[] = [];
    for (const name of all) {
      const holes = compose(defined(definitions.get(name))).opaque.includes(0);
      (holes ? holed : walls).push(name);
    }
    sorted = { walls, middles: [...holed, ...walls] };
    return sorted;
  };
  const assets: SceneAssets = {
    shades,
    names: {
      get walls() {
        return sort().walls;
      },
      flats: flatNames,
      get middles() {
        return sort().middles;
      },
      textures: all,
      custom: [...catalog.customTextures, ...catalog.customFlats].toSorted(),
    },
    texture(name) {
      const cached = textureCache.get(name);
      if (cached) return cached;
      const definition = definitions.get(name);
      if (!definition || name === catalog.placeholder) return missing;
      const picture = compose(definition);
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
          picture.pixels[x * flatSize + y] = lump[y * flatSize + x];
        }
      }
      flatCache.set(name, picture);
      return picture;
    },
    sprite(kind) {
      const frame = spriteFrames[kind];
      return frame === null ? null : assets.frame(frame);
    },
    frame(frame) {
      const cached = spriteCache.get(frame);
      if (cached !== undefined) return cached;
      const lump = spriteLump(spriteLumps, frame);
      let picture: Picture | null = null;
      if (lump && lump.length >= 8) {
        const view = new DataView(
          lump.buffer,
          lump.byteOffset,
          lump.byteLength,
        );
        picture = createPicture(view.getInt16(0, true), view.getInt16(2, true));
        picture.leftOffset = view.getInt16(4, true);
        picture.topOffset = view.getInt16(6, true);
        drawPatch(lump, picture, 0, 0);
      }
      spriteCache.set(frame, picture);
      return picture;
    },
  };
  return assets;
}

function clampShade(level: number) {
  return Math.max(0, Math.min(shadeLevels - 1, level));
}

function lightStart(light: number, contrast: number) {
  const band = Math.max(0, Math.min(15, (light >> 4) + contrast));
  return (15 - band) * 4;
}

// Monster lumps can hold two frames in one name, like BSPIA1D1.
function spriteLump(lumps: Map<string, Uint8Array>, frame: string) {
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
export function createFlatAssets(): SceneAssets {
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
    thingIndexes.set(kind, defined(hexIndexes.get(hex)));
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
    names: {
      walls: freedoomWalls,
      flats: freedoomFlats,
      middles: middleTextures,
      textures: [...middleTextures, ...doorTextures, ...switchTextures],
      custom: [],
    },
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
    frame: () => null,
  };
}

function packColor(red: number, green: number, blue: number) {
  return ((255 << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}

function solidPicture(width: number, height: number, color: number) {
  const picture = createPicture(width, height);
  picture.pixels.fill(color);
  picture.opaque.fill(1);
  return picture;
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
