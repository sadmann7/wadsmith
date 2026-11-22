import {
  complevels,
  higherLevel,
  lineLevel,
  sectorLevel,
  thingLevel,
} from "@/lib/map/complevel";
import type { Complevel } from "@/lib/map/types";
import { lumpSlotIndex, type GameInfo } from "@/lib/engine/game";

export interface GameFile {
  name: string;
  data: Uint8Array;
}

interface Lump {
  name: string;
  data: Uint8Array;
}

export interface WadSummary {
  wads: Uint8Array[];
  dehacked: Uint8Array[];
  // Map numbers in MAP01 to MAP32 order; a Doom 1 WAD's E2M1 is 10.
  maps: number[];
  episodes: boolean;
  complevel: Complevel;
  declared: boolean;
}

export class WadFileError extends Error {}

const episodeLump = /^E\dM\d$/;
const mapParts = new Set([
  "THINGS",
  "LINEDEFS",
  "SIDEDEFS",
  "VERTEXES",
  "SEGS",
  "SSECTORS",
  "NODES",
  "SECTORS",
  "REJECT",
  "BLOCKMAP",
  "BEHAVIOR",
  "TEXTMAP",
]);
// Old editors left junk in the high bits and set this one. MBF21 clears the
// extended flags on such lines, and they're no sign of a Boom map.
const lineReserved = 0x0800;
const lineSize = 14;
const sectorSize = 26;
const thingSize = 10;
// BEX names code pointers without the A_ prefix, as in "FRAME 100 = Spawn".
const codePointer = (names: string) =>
  new RegExp(`=\\s*(A_)?(${names})\\s*$`, "im");
const mbfCodePointers = codePointer(
  "Detonate|Mushroom|Die|Spawn|Turn|Face|Scratch|PlaySound|RandomJump|LineEffect|FireOldBFG|BetaSkullAttack|Stop",
);
const mbf21CodePointers = codePointer(
  "SpawnObject|MonsterProjectile|MonsterBulletAttack|MonsterMeleeAttack|RadiusDamage|NoiseAlert|HealChase|SeekTracer|FindTracer|ClearTracer|JumpIfHealthBelow|JumpIfTargetInSight|JumpIfTargetCloser|JumpIfTracerInSight|JumpIfTracerCloser|JumpIfFlagsSet|AddFlags|RemoveFlags|WeaponProjectile|WeaponBulletAttack|WeaponMeleeAttack|WeaponSound|WeaponAlert|WeaponJump|ConsumeAmmo|CheckAmmo|RefireTo|GunFlashTo",
);

const text = new TextDecoder("latin1");

function lumpName(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  return text.decode(end < 0 ? bytes : bytes.subarray(0, end)).toUpperCase();
}

export function isWad(data: Uint8Array) {
  const magic = text.decode(data.subarray(0, 4));
  return magic === "PWAD" || magic === "IWAD";
}

export function readLumps(file: GameFile): Lump[] {
  const { data } = file;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12 || !isWad(data)) {
    throw new WadFileError(`${file.name} isn't a WAD file.`);
  }
  const count = view.getInt32(4, true);
  const directory = view.getInt32(8, true);
  if (count < 0 || directory < 0 || directory + count * 16 > data.length) {
    throw new WadFileError(`${file.name} is damaged.`);
  }
  return Array.from({ length: count }, (_, index) => {
    const entry = directory + index * 16;
    const offset = view.getInt32(entry, true);
    const size = view.getInt32(entry + 4, true);
    if (offset < 0 || size < 0 || offset + size > data.length) {
      throw new WadFileError(`${file.name} is damaged.`);
    }
    return {
      name: lumpName(data.subarray(entry + 8, entry + 16)),
      data: data.subarray(offset, offset + size),
    };
  });
}

function records(lump: Lump | undefined, size: number) {
  if (!lump) return [];
  const view = new DataView(
    lump.data.buffer,
    lump.data.byteOffset,
    lump.data.byteLength,
  );
  return Array.from(
    { length: Math.floor(lump.data.length / size) },
    (_, i) => ({
      view,
      at: i * size,
    }),
  );
}

function mapLevel(lumps: Lump[]): Complevel {
  let level: Complevel = "vanilla";
  const raise = (next: Complevel) => {
    level = higherLevel(level, next);
  };
  const find = (name: string) => lumps.find((lump) => lump.name === name);
  for (const { view, at } of records(find("LINEDEFS"), lineSize)) {
    const rawFlags = view.getUint16(at + 4, true);
    const flags = rawFlags & lineReserved ? 0 : rawFlags;
    raise(lineLevel(view.getUint16(at + 6, true), flags));
  }
  for (const { view, at } of records(find("SECTORS"), sectorSize)) {
    raise(sectorLevel(view.getUint16(at + 22, true)));
  }
  for (const { view, at } of records(find("THINGS"), thingSize)) {
    raise(thingLevel(view.getInt16(at + 6, true)));
  }
  return level;
}

function patchLevel(patch: string): Complevel {
  if (/^\s*doom version\s*=\s*2021\b/im.test(patch)) return "mbf21";
  if (/\bMBF21 Bits\b/i.test(patch)) return "mbf21";
  if (mbf21CodePointers.test(patch)) return "mbf21";
  if (mbfCodePointers.test(patch)) return "mbf";
  if (
    /^\s*\[(CODEPTR|STRINGS|PARS|HELPER|SPRITES|SOUNDS|MUSIC)\]/im.test(patch)
  ) {
    return "boom";
  }
  return "vanilla";
}

// Maps for the other kind of Doom can't play on the game's IWAD.
export function inspectWads(files: GameFile[], game?: GameInfo): WadSummary {
  const sorted = files.toSorted((a, b) => a.name.localeCompare(b.name));
  const wads = sorted.filter((file) => isWad(file.data));
  const patches = sorted.filter((file) => !isWad(file.data));
  for (const file of patches) {
    if (!/\.(deh|bex)$/i.test(file.name)) {
      throw new WadFileError(
        `${file.name} isn't a WAD file or a DEHACKED patch.`,
      );
    }
  }
  if (wads.length === 0) throw new WadFileError("Choose at least one WAD.");

  const maps = new Set<number>();
  const levels: Complevel[] = [];
  let declared: Complevel | null = null;
  let episodes = false;
  for (const file of wads) {
    const lumps = readLumps(file);
    for (const [index, lump] of lumps.entries()) {
      if (lump.name === "COMPLVL") {
        const named = text.decode(lump.data).trim().toLowerCase();
        if ((complevels as string[]).includes(named)) {
          declared = named as Complevel;
        }
      } else if (lump.name === "DEHACKED") {
        levels.push(patchLevel(text.decode(lump.data)));
      } else if (lump.name === "ANIMATED" || lump.name === "SWITCHES") {
        levels.push("boom");
      }
      const slot = lumpSlotIndex(lump.name);
      if (slot === null) continue;
      if (episodeLump.test(lump.name)) episodes = true;
      const rest = lumps.slice(index + 1);
      const next = rest.findIndex((entry) => !mapParts.has(entry.name));
      const parts = next < 0 ? rest : rest.slice(0, next);
      if (parts[0]?.name === "TEXTMAP") {
        throw new WadFileError(
          `${file.name} uses UDMF maps, which need GZDoom or a similar port.`,
        );
      }
      if (parts.some((part) => part.name === "BEHAVIOR")) {
        throw new WadFileError(
          `${file.name} uses Hexen-format maps, which need ZDoom or a similar port.`,
        );
      }
      maps.add(slot);
      levels.push(mapLevel(parts));
    }
  }
  for (const file of patches) levels.push(patchLevel(text.decode(file.data)));

  if (maps.size === 0) {
    throw new WadFileError("None of these WADs has a map.");
  }
  if (game && episodes !== game.episodes > 0) {
    throw new WadFileError(
      episodes
        ? `These are Doom 1 maps, and the game is ${game.label}. Bring doom.wad to play them.`
        : `These are Doom II maps, and the game is ${game.label}. Bring doom2.wad to play them.`,
    );
  }
  const detected = levels.reduce<Complevel>(
    (highest, level) =>
      complevels.indexOf(level) > complevels.indexOf(highest) ? level : highest,
    "vanilla",
  );
  return {
    wads: wads.map((file) => file.data),
    dehacked: patches.map((file) => file.data),
    maps: [...maps].toSorted((a, b) => a - b),
    episodes,
    complevel: declared ?? detected,
    declared: declared !== null,
  };
}
