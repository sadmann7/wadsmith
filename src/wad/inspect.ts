import type { Complevel } from "../engine/runtime";

type GameFile = { name: string; data: Uint8Array };

type Lump = { name: string; data: Uint8Array };

type WadSummary = {
  wads: Uint8Array[];
  dehacked: Uint8Array[];
  maps: number[];
  complevel: Complevel;
  declared: boolean;
};

class WadFileError extends Error {}

const complevels: Complevel[] = ["vanilla", "boom", "mbf", "mbf21"];
const mapLump = /^MAP(\d\d)$/;
const doomOneLump = /^E\dM\d$/;
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
const lastVanillaLine = 141;
const lastVanillaSector = 17;
const linePassUse = 0x0200;
// Old editors left junk in the high bits and set this one. MBF21 clears the
// extended flags on such lines, and they're no sign of a Boom map.
const lineReserved = 0x0800;
const lineMbf21Flags = 0x3000;
const sectorMbf21Flags = 0x3000;
const mbfSkyLines = new Set([271, 272]);
const mbf21Lines = new Set([1024, 1025, 1026]);
const boomThings = new Set([5001, 5002]);
const mbfHelperDog = 888;
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

function isWad(data: Uint8Array) {
  const magic = text.decode(data.subarray(0, 4));
  return magic === "PWAD" || magic === "IWAD";
}

function readLumps(file: GameFile): Lump[] {
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
    if (complevels.indexOf(next) > complevels.indexOf(level)) level = next;
  };
  const find = (name: string) => lumps.find((lump) => lump.name === name);
  for (const { view, at } of records(find("LINEDEFS"), lineSize)) {
    const rawFlags = view.getUint16(at + 4, true);
    const flags = rawFlags & lineReserved ? 0 : rawFlags;
    const special = view.getUint16(at + 6, true);
    if (flags & lineMbf21Flags || mbf21Lines.has(special)) raise("mbf21");
    else if (mbfSkyLines.has(special)) raise("mbf");
    else if (special > lastVanillaLine || flags & linePassUse) raise("boom");
  }
  for (const { view, at } of records(find("SECTORS"), sectorSize)) {
    const special = view.getUint16(at + 22, true);
    if (special & sectorMbf21Flags) raise("mbf21");
    else if (special > lastVanillaSector) raise("boom");
  }
  for (const { view, at } of records(find("THINGS"), thingSize)) {
    const type = view.getInt16(at + 6, true);
    if (type === mbfHelperDog) raise("mbf");
    else if (boomThings.has(type)) raise("boom");
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

function inspectWads(files: GameFile[]): WadSummary {
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
  let doomOne = false;
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
      } else if (doomOneLump.test(lump.name)) {
        doomOne = true;
      }
      const slot = mapLump.exec(lump.name);
      if (!slot) continue;
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
      maps.add(Number(slot[1]));
      levels.push(mapLevel(parts));
    }
  }
  for (const file of patches) levels.push(patchLevel(text.decode(file.data)));

  if (maps.size === 0) {
    throw new WadFileError(
      doomOne
        ? "These are Doom 1 maps. Wadsmith plays Doom II maps (MAP01 to MAP32)."
        : "None of these WADs has a map.",
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
    complevel: declared ?? detected,
    declared: declared !== null,
  };
}

export { WadFileError, inspectWads, readLumps, type GameFile, type WadSummary };
