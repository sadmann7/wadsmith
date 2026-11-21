import type { Point } from "../map/types";
import { WadFileError, readLumps, type GameFile } from "./inspect";

type DoomLine = {
  start: number;
  end: number;
  flags: number;
  special: number;
  tag: number;
  front: number | null;
  back: number | null;
};

type DoomSide = {
  offsetX: number;
  offsetY: number;
  upper: string;
  lower: string;
  middle: string;
  sector: number;
};

type DoomSector = {
  floor: number;
  ceiling: number;
  floorTexture: string;
  ceilingTexture: string;
  light: number;
  special: number;
  tag: number;
};

type DoomThing = Point & { angle: number; type: number; flags: number };

type DoomMap = {
  slot: string;
  vertices: Point[];
  lines: DoomLine[];
  sides: DoomSide[];
  sectors: DoomSector[];
  things: DoomThing[];
};

const mapLump = /^MAP(0[1-9]|[12][0-9]|3[0-2])$/;
const noSide = 0xffff;
const text = new TextDecoder("latin1");

function name(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  return text.decode(end < 0 ? bytes : bytes.subarray(0, end)).toUpperCase();
}

function records<T>(
  data: Uint8Array | undefined,
  size: number,
  read: (view: DataView, at: number, bytes: Uint8Array) => T,
) {
  if (!data) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: Math.floor(data.length / size) }, (_, index) =>
    read(view, index * size, data.subarray(index * size, (index + 1) * size)),
  );
}

function parseMap(slot: string, lumps: Map<string, Uint8Array>): DoomMap {
  const sides = records(lumps.get("SIDEDEFS"), 30, (view, at, bytes) => ({
    offsetX: view.getInt16(at, true),
    offsetY: view.getInt16(at + 2, true),
    upper: name(bytes.subarray(4, 12)),
    lower: name(bytes.subarray(12, 20)),
    middle: name(bytes.subarray(20, 28)),
    sector: view.getUint16(at + 28, true),
  }));
  const side = (index: number) =>
    index === noSide || index >= sides.length ? null : index;
  return {
    slot,
    vertices: records(lumps.get("VERTEXES"), 4, (view, at) => ({
      x: view.getInt16(at, true),
      y: view.getInt16(at + 2, true),
    })),
    lines: records(lumps.get("LINEDEFS"), 14, (view, at) => ({
      start: view.getUint16(at, true),
      end: view.getUint16(at + 2, true),
      flags: view.getUint16(at + 4, true),
      special: view.getUint16(at + 6, true),
      tag: view.getUint16(at + 8, true),
      front: side(view.getUint16(at + 10, true)),
      back: side(view.getUint16(at + 12, true)),
    })),
    sides,
    sectors: records(lumps.get("SECTORS"), 26, (view, at, bytes) => ({
      floor: view.getInt16(at, true),
      ceiling: view.getInt16(at + 2, true),
      floorTexture: name(bytes.subarray(4, 12)),
      ceilingTexture: name(bytes.subarray(12, 20)),
      light: view.getInt16(at + 20, true),
      special: view.getUint16(at + 22, true),
      tag: view.getUint16(at + 24, true),
    })),
    things: records(lumps.get("THINGS"), 10, (view, at) => ({
      x: view.getInt16(at, true),
      y: view.getInt16(at + 2, true),
      angle: view.getInt16(at + 4, true),
      type: view.getUint16(at + 6, true),
      flags: view.getUint16(at + 8, true),
    })),
  };
}

// A map in a later WAD replaces one in the same slot, as when the engine loads them.
function readMaps(files: GameFile[]): DoomMap[] {
  const maps = new Map<string, DoomMap>();
  let doomOne = false;
  for (const file of files) {
    const lumps = readLumps(file);
    for (const [index, lump] of lumps.entries()) {
      if (/^E\dM\d$/.test(lump.name)) doomOne = true;
      if (!mapLump.test(lump.name)) continue;
      const parts = new Map<string, Uint8Array>();
      for (const part of lumps.slice(index + 1, index + 12)) {
        if (part.name === "TEXTMAP") {
          throw new WadFileError(
            `${lump.name} in ${file.name} is a UDMF map, which the editor can't open.`,
          );
        }
        if (parts.has(part.name) || mapLump.test(part.name)) break;
        parts.set(part.name, part.data);
      }
      if (parts.has("BEHAVIOR")) {
        throw new WadFileError(
          `${lump.name} in ${file.name} is a Hexen-format map, which the editor can't open.`,
        );
      }
      maps.set(lump.name, parseMap(lump.name, parts));
    }
  }
  if (maps.size === 0) {
    throw new WadFileError(
      doomOne
        ? "These are Doom 1 maps. Wadsmith edits Doom II maps (MAP01 to MAP32)."
        : "There are no maps in these files.",
    );
  }
  return [...maps.values()].toSorted((a, b) => a.slot.localeCompare(b.slot));
}

export {
  readMaps,
  type DoomLine,
  type DoomMap,
  type DoomSector,
  type DoomSide,
  type DoomThing,
};
