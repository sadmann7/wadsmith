import { isMapLump } from "@/engine/game";
import type { Point } from "@/map/types";
import { WadFileError, readLumps, type GameFile } from "./inspect";

interface DoomLine {
  start: number;
  end: number;
  flags: number;
  special: number;
  tag: number;
  front: number | null;
  back: number | null;
}

interface DoomSide {
  offsetX: number;
  offsetY: number;
  upper: string;
  lower: string;
  middle: string;
  sector: number;
}

interface DoomSector {
  floor: number;
  ceiling: number;
  floorTexture: string;
  ceilingTexture: string;
  light: number;
  special: number;
  tag: number;
}

type DoomThing = Point & { angle: number; type: number; flags: number };

interface DoomMap {
  slot: string;
  vertices: Point[];
  lines: DoomLine[];
  sides: DoomSide[];
  sectors: DoomSector[];
  things: DoomThing[];
  title?: string;
}

const noSide = 0xffff;
const text = new TextDecoder("latin1");
const levelString = /^\s*HUSTR_(\d+)\s*=\s*(.*?)\s*$/gim;
const levelInfo = /^\s*map\s+(MAP\d\d|E\dM\d)\s*\{([^}]*)\}/gim;
const levelName = /^\s*levelname\s*=\s*"([^"]*)"/im;

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
// Titles often repeat the slot, as in "MAP01: Entryway".
function titleOf(slot: string, value: string) {
  const title = value.replace(/^(MAP\d\d|level \d+)\s*:\s*/i, "").trim();
  return title && title.toUpperCase() !== slot ? title : null;
}

function readTitles(lumpName: string, data: Uint8Array) {
  const source = text.decode(data);
  const titles: [string, string][] = [];
  if (lumpName === "DEHACKED") {
    for (const [, number, value] of source.matchAll(levelString)) {
      const slot = `MAP${number.padStart(2, "0")}`;
      const title = titleOf(slot, value);
      if (isMapLump(slot) && title) titles.push([slot, title]);
    }
  } else {
    for (const [, slot, body] of source.matchAll(levelInfo)) {
      const title = titleOf(
        slot.toUpperCase(),
        levelName.exec(body)?.[1] ?? "",
      );
      if (title) titles.push([slot.toUpperCase(), title]);
    }
  }
  return titles;
}

function readMaps(files: GameFile[]): DoomMap[] {
  const maps = new Map<string, DoomMap>();
  const titles = new Map<string, string>();
  for (const file of files) {
    const lumps = readLumps(file);
    for (const [index, lump] of lumps.entries()) {
      if (lump.name === "DEHACKED" || lump.name === "UMAPINFO") {
        for (const [slot, title] of readTitles(lump.name, lump.data)) {
          titles.set(slot, title);
        }
      }
      if (!isMapLump(lump.name)) continue;
      const parts = new Map<string, Uint8Array>();
      for (const part of lumps.slice(index + 1, index + 12)) {
        if (part.name === "TEXTMAP") {
          throw new WadFileError(
            `${lump.name} in ${file.name} is a UDMF map, which the editor can't open.`,
          );
        }
        if (parts.has(part.name) || isMapLump(part.name)) break;
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
    throw new WadFileError("There are no maps in these files.");
  }
  return [...maps.values()]
    .map((map) =>
      titles.has(map.slot) ? { ...map, title: titles.get(map.slot) } : map,
    )
    .toSorted((a, b) => a.slot.localeCompare(b.slot));
}

export {
  readMaps,
  type DoomLine,
  type DoomMap,
  type DoomSector,
  type DoomSide,
  type DoomThing,
};
