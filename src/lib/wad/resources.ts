import type { Lump } from "./compile";

import { readLumps } from "./inspect";
import { packWad } from "./pack";

export interface PatchPlacement {
  name: string;
  x: number;
  y: number;
}

export interface TextureDefinition {
  name: string;
  width: number;
  height: number;
  patches: PatchPlacement[];
}

// One WAD's textures, flats and other lumps by name. A later lump of a name
// replaces an earlier one, as in the engine.
export interface WadTextures {
  definitions: Map<string, TextureDefinition>;
  // TEXTURE1 and TEXTURE2 in their own order, which a rebuilt lump has to
  // keep.
  first: TextureDefinition[];
  second: TextureDefinition[];
  patchNames: string[];
  flats: Map<string, Uint8Array>;
  // Every lump between the flat markers in WAD order, sub-markers too, as the
  // engine numbers flats.
  flatOrder: string[];
  lumps: Map<string, Uint8Array>;
  hasPatchMarkers: boolean;
}

export interface TextureSource {
  iwad: Uint8Array;
  resources: Uint8Array[];
}

// The game's textures with every resource's laid over them.
export interface TextureCatalog {
  definitions: Map<string, TextureDefinition>;
  // The game's first texture, which the engine can't draw.
  placeholder: string | null;
  flats: Map<string, Uint8Array>;
  // The game's flat lumps as the engine numbers them.
  flatOrder: string[];
  lumps: Map<string, Uint8Array>;
  // What a resource adds or changes, which a built WAD has to carry.
  customTextures: Set<string>;
  customFlats: Set<string>;
  customPatches: Map<string, Uint8Array>;
}

type FramePair = [first: string, last: string];

// Pixels are stored a column at a time, as the engine draws them.
export interface IndexedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
  opaque: Uint8Array;
}

export const flatSize = 64;
export const largestImage = 1024;

const flatBytes = flatSize * flatSize;
const flatStarts = new Set(["F_START", "FF_START"]);
const flatEnds = new Set(["F_END", "FF_END"]);
const patchStarts = new Set(["P_START", "PP_START"]);

const longestPost = 128;
const lastAbsoluteRow = 254;
const columnEnd = 0xff;

// Lumps an engine reads by name wherever they sit, so a patch of the same
// name would take their place.
const engineLumps = new Set([
  "ANIMATED",
  "COLORMAP",
  "COMPLVL",
  "DEHACKED",
  "DMXGUS",
  "ENDOOM",
  "GENMIDI",
  "MAPINFO",
  "PLAYPAL",
  "PNAMES",
  "SWITCHES",
  "TEXTURE1",
  "TEXTURE2",
  "TRANMAP",
  "UMAPINFO",
]);
const markerOrMap = /^([A-Z]{1,2}\d?_(START|END)|MAP\d\d|E\dM\d)$/;

const cache = new WeakMap<Uint8Array, WadTextures>();
// The last catalog built over each game, which is the one asked for again
// until a resource is added or removed.
const catalogs = new WeakMap<
  Uint8Array,
  { resources: Uint8Array[]; catalog: TextureCatalog }
>();

export function readWadTextures(data: Uint8Array, name = "resource.wad") {
  const known = cache.get(data);
  if (known) return known;
  const lumps = new Map<string, Uint8Array>();
  const flats = new Map<string, Uint8Array>();
  const flatOrder: string[] = [];
  let inFlats = false;
  let hasPatchMarkers = false;
  for (const lump of readLumps({ name, data })) {
    if (flatStarts.has(lump.name)) inFlats = true;
    else if (flatEnds.has(lump.name)) inFlats = false;
    else if (inFlats) {
      flatOrder.push(lump.name);
      if (lump.data.length === flatBytes) flats.set(lump.name, lump.data);
      continue;
    }
    if (patchStarts.has(lump.name)) hasPatchMarkers = true;
    lumps.set(lump.name, lump.data);
  }
  const patchNames = readPatchNames(lumps.get("PNAMES"));
  const first = readDefinitions(lumps.get("TEXTURE1"), patchNames);
  const second = readDefinitions(lumps.get("TEXTURE2"), patchNames);
  const definitions = new Map<string, TextureDefinition>();
  for (const definition of [...first, ...second]) {
    if (!definitions.has(definition.name)) {
      definitions.set(definition.name, definition);
    }
  }
  const textures: WadTextures = {
    definitions,
    first,
    second,
    patchNames,
    flats,
    flatOrder,
    lumps,
    hasPatchMarkers,
  };
  cache.set(data, textures);
  return textures;
}

export function getHasTextures(data: Uint8Array) {
  const textures = readWadTextures(data);
  return (
    textures.definitions.size > 0 ||
    textures.flats.size > 0 ||
    textures.hasPatchMarkers
  );
}

export function readTextureCatalog(source: TextureSource): TextureCatalog {
  const known = catalogs.get(source.iwad);
  if (
    known &&
    known.resources.length === source.resources.length &&
    known.resources.every((data, index) => data === source.resources[index])
  ) {
    return known.catalog;
  }
  const catalog = mergeTextures(source);
  catalogs.set(source.iwad, { resources: [...source.resources], catalog });
  return catalog;
}

// A built WAD replaces the game's PNAMES and texture lumps outright, so they
// come out whole with the new entries added, and only what the maps use goes
// in. An animation or a switch goes in whole, since the engine runs from its
// first frame to its last by number.
export function textureLumps(
  mapLumps: Lump[],
  source: TextureSource,
  extraTextures: readonly string[] = [],
): Lump[] {
  if (source.resources.length === 0) return [];
  const catalog = readTextureCatalog(source);
  const base = readWadTextures(source.iwad, "iwad.wad");
  const sets = readFrameSets(base.lumps);
  const used = usedNames(mapLumps);
  for (const name of extraTextures) used.textures.add(name);

  const textureOrder = [...catalog.definitions.keys()];
  const together = [
    ...sets.textures.map((pair) => framesBetween(textureOrder, pair)),
    ...sets.switches,
    ...[...used.textures].flatMap((name) => {
      const pressed = /^SW([12])(.*)$/.exec(name);
      return pressed
        ? [[name, `SW${pressed[1] === "1" ? 2 : 1}${pressed[2]}`]]
        : [];
    }),
  ];
  for (const frames of together) {
    if (frames.some((name) => used.textures.has(name))) {
      for (const name of frames) used.textures.add(name);
    }
  }
  const textures = [...used.textures]
    .flatMap((name) => catalog.definitions.get(name) ?? [])
    .toSorted((a, b) => compareNames(a.name, b.name));
  const changed = textures.filter((definition) =>
    catalog.customTextures.has(definition.name),
  );
  const patches = new Map<string, Uint8Array>();
  for (const definition of textures) {
    for (const patch of definition.patches) {
      const lump = catalog.customPatches.get(patch.name);
      if (lump) patches.set(patch.name, lump);
    }
  }

  // A flat in a WAD is numbered after the game's, so a changed frame takes
  // the rest of its animation with it, the game's own frames included.
  const flatOrder = [...catalog.flats.keys()];
  const animated = new Set<string>();
  for (const pair of sets.flats) {
    const frames = framesBetween(flatOrder, pair);
    if (
      frames.some((name) => used.flats.has(name)) &&
      frames.some((name) => catalog.customFlats.has(name)) &&
      !frames.some((name) => animated.has(name))
    ) {
      for (const name of frames) animated.add(name);
    }
  }
  const flats = [
    ...animated,
    ...[...used.flats]
      .filter((name) => catalog.customFlats.has(name) && !animated.has(name))
      .toSorted(compareNames),
  ];

  const lumps: Lump[] = [];
  if (changed.length > 0) {
    const patchNames = [...base.patchNames];
    const indexes = new Map(patchNames.map((name, index) => [name, index]));
    const indexOf = (name: string) => {
      const known = indexes.get(name);
      if (known !== undefined) return known;
      indexes.set(name, patchNames.length);
      patchNames.push(name);
      return patchNames.length - 1;
    };
    const replaced = new Map(changed.map((item) => [item.name, item]));
    const kept = (list: TextureDefinition[]) =>
      list.map((definition) => replaced.get(definition.name) ?? definition);
    const added = changed.filter(
      (definition) => !base.definitions.has(definition.name),
    );
    const texture1 = encodeDefinitions(
      [...kept(base.first), ...added],
      indexOf,
    );
    // Doom's second texture lump keeps its place, so its numbers don't move.
    const texture2 = base.second.some((item) => replaced.has(item.name))
      ? encodeDefinitions(kept(base.second), indexOf)
      : null;
    lumps.push(
      { name: "PNAMES", data: encodePatchNames(patchNames) },
      { name: "TEXTURE1", data: texture1 },
      ...(texture2 ? [{ name: "TEXTURE2", data: texture2 }] : []),
    );
  }
  if (patches.size > 0) {
    lumps.push(
      marker("PP_START"),
      ...[...patches].map(([name, data]) => ({ name, data })),
      marker("PP_END"),
    );
  }
  if (flats.length > 0) {
    lumps.push(
      marker("FF_START"),
      ...flats.flatMap((name) => {
        const data = catalog.flats.get(name);
        return data ? [{ name, data }] : [];
      }),
      marker("FF_END"),
    );
  }
  return lumps;
}

// The palette is 256 colors of three bytes. A pixel less than half opaque is
// left out, and the rest take the nearest color.
export function quantizeImage(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
): IndexedImage {
  const pixels = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  const nearest = new Map<number, number>();
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] < 128) continue;
      const red = rgba[at];
      const green = rgba[at + 1];
      const blue = rgba[at + 2];
      const key = (red << 16) | (green << 8) | blue;
      let color = nearest.get(key);
      if (color === undefined) {
        color = nearestColor(palette, red, green, blue);
        nearest.set(key, color);
      }
      pixels[x * height + y] = color;
      opaque[x * height + y] = 1;
    }
  }
  return { width, height, pixels, opaque };
}

// Doom's picture format: a header, an offset per column, and each column as
// posts of up to 128 opaque pixels. A post's start is a byte, so past row 254
// it counts from the post above, with empty posts to bridge a long gap.
export function encodePatch(image: IndexedImage) {
  const { width, height, pixels, opaque } = image;
  const columns: number[][] = [];
  for (let x = 0; x < width; x += 1) {
    const bytes: number[] = [];
    let above = -1;
    let y = 0;
    while (y < height) {
      if (!opaque[x * height + y]) {
        y += 1;
        continue;
      }
      let end = y;
      while (
        end < height &&
        end - y < longestPost &&
        opaque[x * height + end]
      ) {
        end += 1;
      }
      let start = y;
      if (y > lastAbsoluteRow) {
        while (y - above > lastAbsoluteRow || y - above > above) {
          bytes.push(lastAbsoluteRow, 0, 0, 0);
          above =
            above < lastAbsoluteRow ? lastAbsoluteRow : above + lastAbsoluteRow;
        }
        start = y - above;
      }
      const run = pixels.subarray(x * height + y, x * height + end);
      bytes.push(start, run.length, run[0], ...run, run[run.length - 1]);
      above = y;
      y = end;
    }
    bytes.push(columnEnd);
    columns.push(bytes);
  }
  const headerSize = 8 + width * 4;
  const size = columns.reduce((total, column) => total + column.length, 0);
  const patch = new Uint8Array(headerSize + size);
  const view = new DataView(patch.buffer);
  view.setInt16(0, width, true);
  view.setInt16(2, height, true);
  let offset = headerSize;
  columns.forEach((column, x) => {
    view.setInt32(8 + x * 4, offset, true);
    patch.set(column, offset);
    offset += column.length;
  });
  return patch;
}

// The reverse of encodePatch, for any patch lump.
export function drawPatch(
  patch: Uint8Array,
  target: IndexedImage,
  originX: number,
  originY: number,
) {
  if (patch.length < 8) return;
  const view = new DataView(patch.buffer, patch.byteOffset, patch.byteLength);
  const width = view.getInt16(0, true);
  for (let column = 0; column < width; column += 1) {
    const x = originX + column;
    const entry = 8 + column * 4;
    if (entry + 4 > patch.length) return;
    let post = view.getInt32(entry, true);
    let top = -1;
    while (post >= 0 && post + 1 < patch.length && patch[post] !== columnEnd) {
      const delta = patch[post];
      top = delta <= top ? top + delta : delta;
      const length = patch[post + 1];
      for (let row = 0; row < length; row += 1) {
        const y = originY + top + row;
        const from = post + 3 + row;
        if (from >= patch.length) break;
        if (x >= 0 && x < target.width && y >= 0 && y < target.height) {
          const index = x * target.height + y;
          target.pixels[index] = patch[from];
          target.opaque[index] = 1;
        }
      }
      post += length + 4;
    }
  }
}

// A flat is 64 by 64 with no holes, a row at a time.
export function encodeFlat(image: IndexedImage) {
  const flat = new Uint8Array(flatBytes);
  for (let x = 0; x < flatSize; x += 1) {
    for (let y = 0; y < flatSize; y += 1) {
      flat[y * flatSize + x] = image.pixels[x * image.height + y];
    }
  }
  return flat;
}

// One texture per image, each made of its own patch, and a flat as well for
// every image of a flat's size.
export function buildTextureWad(
  images: { name: string; image: IndexedImage }[],
) {
  const names = images.map(({ name }) => name);
  const definitions = images.map(({ name, image }) => ({
    name,
    width: image.width,
    height: image.height,
    patches: [{ name, x: 0, y: 0 }],
  }));
  const flats = images.filter(
    ({ image }) => image.width === flatSize && image.height === flatSize,
  );
  return packWad([
    { name: "PNAMES", data: encodePatchNames(names) },
    {
      name: "TEXTURE1",
      data: encodeDefinitions(definitions, (name) => names.indexOf(name)),
    },
    marker("PP_START"),
    ...images.map(({ name, image }) => ({ name, data: encodePatch(image) })),
    marker("PP_END"),
    ...(flats.length > 0
      ? [
          marker("FF_START"),
          ...flats.map(({ name, image }) => ({
            name,
            data: encodeFlat(image),
          })),
          marker("FF_END"),
        ]
      : []),
  ]);
}

// Every name the game and the resources already use, for lumpNameFor.
export function takenNames(source: TextureSource) {
  const catalog = readTextureCatalog(source);
  return new Set([
    ...catalog.lumps.keys(),
    ...catalog.definitions.keys(),
    ...catalog.flats.keys(),
    ...source.resources.flatMap((resource) => [
      ...readWadTextures(resource).lumps.keys(),
    ]),
  ]);
}

// A lump name is up to eight of these characters, so a file's name is cut to
// fit and told apart from the ones already taken. A name can't start with a
// dash, which the engine reads as no texture.
export function lumpNameFor(fileName: string, taken: Set<string>) {
  const stem = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]*$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^[_-]+|_+$/g, "");
  const base = (stem || "IMAGE").slice(0, 8);
  const free = (name: string) =>
    !taken.has(name) &&
    !engineLumps.has(name) &&
    !markerOrMap.test(name) &&
    !animationStarts.has(name);
  let name = base;
  for (let count = 2; !free(name); count += 1) {
    const suffix = String(count);
    name = `${base.slice(0, 8 - suffix.length)}${suffix}`;
  }
  return name;
}

function mergeTextures(source: TextureSource): TextureCatalog {
  const base = readWadTextures(source.iwad, "iwad.wad");
  const packs = source.resources.map((resource) => readWadTextures(resource));
  const definitions = new Map(base.definitions);
  const flats = new Map(base.flats);
  const lumps = new Map(base.lumps);
  const customTextures = new Set<string>();
  const customFlats = new Set<string>();
  const customPatches = new Map<string, Uint8Array>();
  // Only patches cross over, so a resource's own palette or maps stay out.
  const patchNames = new Set(
    [base, ...packs].flatMap((pack) => pack.patchNames),
  );
  for (const pack of packs) {
    for (const [name, lump] of pack.lumps) {
      if (!patchNames.has(name) || engineLumps.has(name)) continue;
      lumps.set(name, lump);
      const known = base.lumps.get(name);
      if (known && getIsSameBytes(known, lump)) customPatches.delete(name);
      else customPatches.set(name, lump);
    }
    for (const [name, definition] of pack.definitions) {
      definitions.set(name, definition);
    }
    for (const [name, flat] of pack.flats) {
      flats.set(name, flat);
      const known = base.flats.get(name);
      if (known && getIsSameBytes(known, flat)) customFlats.delete(name);
      else customFlats.add(name);
    }
  }
  for (const pack of packs) {
    for (const name of pack.definitions.keys()) {
      const known = base.definitions.get(name);
      const current = definitions.get(name);
      if (!current) continue;
      if (!known || !getIsSameDefinition(known, current)) {
        customTextures.add(name);
      }
    }
  }
  // The engine stops on an animation that has its first frame and not its
  // last, so a resource can't bring the first frame alone.
  const sets = readFrameSets(base.lumps);
  for (const [first, last] of sets.flats) {
    if (customFlats.has(first) && !flats.has(last)) {
      flats.delete(first);
      customFlats.delete(first);
    }
  }
  for (const [first, last] of sets.textures) {
    if (customTextures.has(first) && !definitions.has(last)) {
      definitions.delete(first);
      customTextures.delete(first);
    }
  }
  return {
    definitions,
    placeholder: base.first[0]?.name ?? null,
    flats,
    flatOrder: base.flatOrder,
    lumps,
    customTextures,
    customFlats,
    customPatches,
  };
}

// The engine's own animations, each from its first frame to its last. A game
// with an ANIMATED lump names its own instead.
const animatedFlats: FramePair[] = [
  ["NUKAGE1", "NUKAGE3"],
  ["FWATER1", "FWATER4"],
  ["SWATER1", "SWATER4"],
  ["LAVA1", "LAVA4"],
  ["BLOOD1", "BLOOD3"],
  ["RROCK05", "RROCK08"],
  ["SLIME01", "SLIME04"],
  ["SLIME05", "SLIME08"],
  ["SLIME09", "SLIME12"],
];
const animatedTextures: FramePair[] = [
  ["BLODGR1", "BLODGR4"],
  ["SLADRIP1", "SLADRIP3"],
  ["BLODRIP1", "BLODRIP4"],
  ["FIREWALA", "FIREWALL"],
  ["GSTFONT1", "GSTFONT3"],
  ["FIRELAV3", "FIRELAVA"],
  ["FIREMAG1", "FIREMAG3"],
  ["FIREBLU1", "FIREBLU2"],
  ["ROCKRED1", "ROCKRED3"],
  ["BFALL1", "BFALL4"],
  ["SFALL1", "SFALL4"],
  ["WFALL1", "WFALL4"],
  ["DBRAIN1", "DBRAIN4"],
];
// An image never takes the name of an animation's first frame, since a game
// without that animation would then have a first frame with no last.
const animationStarts = new Set(
  [...animatedFlats, ...animatedTextures].map(([first]) => first),
);
const animationSize = 23;
const switchSize = 20;

// The frames an animation runs through and the two faces of each switch,
// from the game's own lists when it has them.
function readFrameSets(lumps: Map<string, Uint8Array>) {
  const animations = lumps.get("ANIMATED");
  const pressed = lumps.get("SWITCHES") ?? new Uint8Array();
  const switches: FramePair[] = [];
  // Each entry is two names of nine bytes and the games it belongs to, and
  // the list ends at an entry for no game.
  for (
    let at = 0;
    at + switchSize <= pressed.length &&
    (pressed[at + 18] !== 0 || pressed[at + 19] !== 0);
    at += switchSize
  ) {
    switches.push([readName(pressed, at), readName(pressed, at + 9)]);
  }
  if (!animations) {
    return { flats: animatedFlats, textures: animatedTextures, switches };
  }
  const flats: FramePair[] = [];
  const textures: FramePair[] = [];
  // Each entry is a kind, the last frame, the first frame and a speed, and
  // the list ends at a kind of 255.
  for (
    let at = 0;
    at + animationSize <= animations.length && animations[at] !== columnEnd;
    at += animationSize
  ) {
    const pair: FramePair = [
      readName(animations, at + 10),
      readName(animations, at + 1),
    ];
    (animations[at] === 0 ? flats : textures).push(pair);
  }
  return { flats, textures, switches };
}

function framesBetween(order: string[], [first, last]: FramePair) {
  const from = order.indexOf(first);
  const to = order.indexOf(last);
  return from >= 0 && to > from ? order.slice(from, to + 1) : [];
}

// Plain character order, so a WAD builds the same in every locale.
function compareNames(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function readPatchNames(lump: Uint8Array | undefined) {
  if (!lump || lump.length < 4) return [];
  const view = new DataView(lump.buffer, lump.byteOffset, lump.byteLength);
  const count = Math.min(
    view.getInt32(0, true),
    Math.floor((lump.length - 4) / 8),
  );
  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    readName(lump, 4 + index * 8),
  );
}

function readName(bytes: Uint8Array, offset: number) {
  let name = "";
  for (let index = 0; index < 8 && bytes[offset + index]; index += 1) {
    name += String.fromCharCode(bytes[offset + index]);
  }
  return name.toUpperCase();
}

function readDefinitions(
  lump: Uint8Array | undefined,
  patchNames: string[],
): TextureDefinition[] {
  if (!lump || lump.length < 4) return [];
  const view = new DataView(lump.buffer, lump.byteOffset, lump.byteLength);
  const count = view.getInt32(0, true);
  const definitions: TextureDefinition[] = [];
  for (let index = 0; index < count; index += 1) {
    if (8 + index * 4 > lump.length) break;
    const entry = view.getInt32(4 + index * 4, true);
    if (entry < 0 || entry + 22 > lump.length) continue;
    const patchCount = view.getInt16(entry + 20, true);
    const patches: PatchPlacement[] = [];
    for (let at = 0; at < patchCount; at += 1) {
      const patch = entry + 22 + at * 10;
      if (patch + 10 > lump.length) break;
      const name = patchNames[view.getInt16(patch + 4, true)];
      if (name === undefined) continue;
      patches.push({
        name,
        x: view.getInt16(patch, true),
        y: view.getInt16(patch + 2, true),
      });
    }
    definitions.push({
      name: readName(lump, entry),
      width: view.getInt16(entry + 12, true),
      height: view.getInt16(entry + 14, true),
      patches,
    });
  }
  return definitions;
}

function getIsSameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function getIsSameDefinition(a: TextureDefinition, b: TextureDefinition) {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.patches.length === b.patches.length &&
    a.patches.every((patch, index) => {
      const other = b.patches[index];
      return (
        patch.name === other.name && patch.x === other.x && patch.y === other.y
      );
    })
  );
}

const sideSize = 30;
const sectorSize = 26;
const noTexture = "-";

function usedNames(mapLumps: Lump[]) {
  const textures = new Set<string>();
  const flats = new Set<string>();
  for (const lump of mapLumps) {
    if (lump.name === "SIDEDEFS") {
      for (let at = 0; at + sideSize <= lump.data.length; at += sideSize) {
        for (const offset of [4, 12, 20]) {
          const name = readName(lump.data, at + offset);
          if (name !== noTexture) textures.add(name);
        }
      }
    } else if (lump.name === "SECTORS") {
      for (let at = 0; at + sectorSize <= lump.data.length; at += sectorSize) {
        flats.add(readName(lump.data, at + 4));
        flats.add(readName(lump.data, at + 12));
      }
    }
  }
  return { textures, flats };
}

function encodePatchNames(names: string[]) {
  const lump = new Uint8Array(4 + names.length * 8);
  new DataView(lump.buffer).setInt32(0, names.length, true);
  names.forEach((name, index) => writeName(lump, 4 + index * 8, name));
  return lump;
}

function writeName(bytes: Uint8Array, offset: number, name: string) {
  for (let index = 0; index < 8; index += 1) {
    bytes[offset + index] = name.charCodeAt(index) || 0;
  }
}

function encodeDefinitions(
  definitions: TextureDefinition[],
  indexOf: (patch: string) => number,
) {
  const directory = 4 + definitions.length * 4;
  const size = definitions.reduce(
    (total, definition) => total + 22 + definition.patches.length * 10,
    directory,
  );
  const lump = new Uint8Array(size);
  const view = new DataView(lump.buffer);
  view.setInt32(0, definitions.length, true);
  let offset = directory;
  definitions.forEach((definition, index) => {
    view.setInt32(4 + index * 4, offset, true);
    writeName(lump, offset, definition.name);
    view.setInt16(offset + 12, definition.width, true);
    view.setInt16(offset + 14, definition.height, true);
    view.setInt16(offset + 20, definition.patches.length, true);
    definition.patches.forEach((patch, at) => {
      const entry = offset + 22 + at * 10;
      view.setInt16(entry, patch.x, true);
      view.setInt16(entry + 2, patch.y, true);
      view.setInt16(entry + 4, indexOf(patch.name), true);
      view.setInt16(entry + 6, 1, true);
    });
    offset += 22 + definition.patches.length * 10;
  });
  return lump;
}

function marker(name: string): Lump {
  return { name, data: new Uint8Array() };
}

function nearestColor(
  palette: Uint8Array,
  red: number,
  green: number,
  blue: number,
) {
  let best = 0;
  let distance = Infinity;
  for (let color = 0; color < 256; color += 1) {
    const dr = palette[color * 3] - red;
    const dg = palette[color * 3 + 1] - green;
    const db = palette[color * 3 + 2] - blue;
    const candidate = dr * dr + dg * dg + db * db;
    if (candidate < distance) {
      distance = candidate;
      best = color;
    }
  }
  return best;
}
