import { spriteNames, stateFrames, vanillaThings } from "./doom-info";

export type CustomCategory = "enemy" | "item" | "decor";

export interface CustomThing {
  // The editor number a map places it by.
  type: number;
  name: string;
  radius: number;
  height: number;
  category: CustomCategory;
  // Its first frame's sprite and frame letter, like "SP00A".
  sprite: string | null;
  // Whether it relies on MBF21's thing fields, frame args or code pointers,
  // which the engine ignores below MBF21.
  isMbf21: boolean;
}

interface ThingPatch {
  number: number;
  name: string | null;
  fields: Map<string, string>;
}

const fullBright = 0x8000;
const blockHeader =
  /^(thing|frame|pointer|sound|ammo|weapon|cheat|misc|sprite)\s+(\d+)\s*(?:\((.*)\))?\s*$/i;

// A map stores editor numbers as signed 16-bit values.
const typeLimit = 32767;

export const mbf21CodePointers = new Set(
  [
    "SpawnObject",
    "MonsterProjectile",
    "MonsterBulletAttack",
    "MonsterMeleeAttack",
    "RadiusDamage",
    "NoiseAlert",
    "HealChase",
    "SeekTracer",
    "FindTracer",
    "ClearTracer",
    "JumpIfHealthBelow",
    "JumpIfTargetInSight",
    "JumpIfTargetCloser",
    "JumpIfTracerInSight",
    "JumpIfTracerCloser",
    "JumpIfFlagsSet",
    "AddFlags",
    "RemoveFlags",
    "WeaponProjectile",
    "WeaponBulletAttack",
    "WeaponMeleeAttack",
    "WeaponSound",
    "WeaponAlert",
    "WeaponJump",
    "ConsumeAmmo",
    "CheckAmmo",
    "RefireTo",
    "GunFlashTo",
  ].map((name) => name.toLowerCase()),
);

const mbf21ThingFields = [
  "mbf21 bits",
  "infighting group",
  "projectile group",
  "splash group",
  "fast speed",
  "melee range",
  "rip sound",
];
const stateFields = [
  "initial frame",
  "first moving frame",
  "injury frame",
  "close attack frame",
  "far attack frame",
  "death frame",
  "exploding frame",
  "respawn frame",
];

// The things DEHACKED or BEX patches give editor numbers of their own, with
// what a map editor needs to show them. Patches apply in order, as the engine
// loads them, and anything else in them is left alone.
export function parseDehacked(...patches: string[]): CustomThing[] {
  const things = new Map<number, ThingPatch>();
  const frames = new Map<number, Map<string, string>>();
  const renamed = new Map<number, string>();
  // The engine gives each thing past its own table a slot when a patch first
  // names it.
  const slots = new Map<number, number>();
  const mention = (number: number) => {
    if (number > vanillaThings.length && !slots.has(number)) {
      slots.set(number, vanillaThings.length + slots.size);
    }
  };
  for (const patch of patches) {
    let fields: Map<string, string> | null = null;
    let section: string | null = null;
    const lines = patch.replace(/\r\n?/g, "\n").split("\n");
    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at].trim();
      if (!line || line.startsWith("#")) continue;
      const text = /^text\s+(\d+)\s+(\d+)\s*$/i.exec(line);
      if (text) {
        at += skipText(lines, at + 1, Number(text[1]) + Number(text[2]));
        fields = null;
        section = null;
        continue;
      }
      const bracket = /^\[(\w+)\]$/.exec(line);
      if (bracket) {
        section = bracket[1].toUpperCase();
        fields = null;
        continue;
      }
      const header = blockHeader.exec(line);
      if (header) {
        section = null;
        const kind = header[1].toLowerCase();
        const number = Number(header[2]);
        // A patch made of several may name the same thing or frame again,
        // and the later fields add to the earlier ones.
        if (kind === "thing") {
          mention(number);
          const known = things.get(number);
          const name = header[3]?.trim() || known?.name || null;
          fields = known?.fields ?? new Map();
          things.set(number, { number, name, fields });
        } else if (kind === "frame") {
          fields = frameFields(frames, number);
        } else {
          fields = new Map();
        }
        continue;
      }
      const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
      if (!pair) continue;
      const key = pair[1].trim().toLowerCase();
      if (section === "SPRITES") {
        const index = /^\d+$/.test(key)
          ? Number(key)
          : spriteNames.indexOf(key.toUpperCase());
        if (index >= 0) renamed.set(index, pair[2].trim().toUpperCase());
      } else if (section === "CODEPTR") {
        const frame = /^frame\s+(\d+)$/.exec(key);
        if (frame) {
          frameFields(frames, Number(frame[1])).set("pointer", pair[2].trim());
        }
      } else if (fields) {
        fields.set(key, pair[2].trim());
        if (key === "dropped item") mention(numberOf(pair[2]) ?? 0);
      }
    }
  }

  const hasMbf21Frames = [...frames.values()].some(getIsMbf21Frame);
  // A frame the patches leave alone leads on as the game's own frames do,
  // which aren't known here, so reaching one counts every MBF21 frame.
  const getReachesMbf21Frame = (thing: Map<string, string>) => {
    const seen = new Set<number>();
    const queue = stateFields.flatMap(
      (field) => numberOf(thing.get(field)) ?? [],
    );
    for (const state of queue) {
      if (state === 0 || seen.has(state)) continue;
      seen.add(state);
      const frame = frames.get(state);
      if (!frame) return hasMbf21Frames;
      if (getIsMbf21Frame(frame)) return true;
      const next = numberOf(frame.get("next frame"));
      if (next === null) return hasMbf21Frames;
      queue.push(next);
    }
    return false;
  };

  const spriteOf = (state: number) => {
    const frame = frames.get(state);
    const vanilla = stateFrames[state];
    const sprite =
      numberOf(frame?.get("sprite number")) ??
      (vanilla === undefined ? null : Math.floor(vanilla / 64));
    const sub =
      numberOf(frame?.get("sprite subnumber")) ??
      (vanilla === undefined ? 0 : vanilla % 64);
    if (sprite === null) return null;
    const name = renamed.get(sprite) ?? spriteNames[sprite];
    if (!name || name === "TNT1") return null;
    return `${name}${String.fromCharCode(65 + (sub & ~fullBright))}`;
  };

  // The engine looks a thing up by its editor number from its last slot down,
  // so a later entry here takes the number over.
  const slotOf = (number: number) => slots.get(number) ?? number - 1;
  const numbered = [...things.values()].toSorted(
    (a, b) => slotOf(a.number) - slotOf(b.number),
  );
  return numbered.flatMap(({ number, name, fields: thing }) => {
    const type = numberOf(thing.get("id #"));
    if (type === null || type <= 0 || type > typeLimit) return [];
    const vanilla = vanillaThings[number - 1];
    const bits = thing.get("bits");
    const category =
      bits === undefined ? vanillaCategory(vanilla?.[4]) : categoryOf(bits);
    const state = numberOf(thing.get("initial frame")) ?? vanilla?.[1] ?? null;
    return [
      {
        type,
        name: name ?? `Thing ${number}`,
        radius: fixedOf(thing.get("width")) ?? vanilla?.[2] ?? 20,
        height: fixedOf(thing.get("height")) ?? vanilla?.[3] ?? 16,
        category,
        sprite: state === null ? null : spriteOf(state),
        isMbf21:
          mbf21ThingFields.some((field) => thing.has(field)) ||
          (number > vanillaThings.length
            ? getReachesMbf21Frame(thing)
            : hasMbf21Frames),
      },
    ];
  });
}

const mbf21FrameFields = [
  "mbf21 bits",
  ...Array.from({ length: 8 }, (_, index) => `args${index + 1}`),
];

function getIsMbf21Frame(frame: Map<string, string>) {
  const pointer = frame.get("pointer")?.toLowerCase().replace(/^a_/, "");
  return (
    (pointer !== undefined && mbf21CodePointers.has(pointer)) ||
    mbf21FrameFields.some((field) => frame.has(field))
  );
}

function frameFields(frames: Map<number, Map<string, string>>, number: number) {
  const known = frames.get(number);
  if (known) return known;
  const fields = new Map<string, string>();
  frames.set(number, fields);
  return fields;
}

// A Text block replaces one string with another, written out over as many
// characters and lines as they take, which may look like anything.
function skipText(lines: string[], from: number, characters: number) {
  let left = characters;
  let skipped = 0;
  while (left > 0 && from + skipped < lines.length) {
    left -= lines[from + skipped].length + 1;
    skipped += 1;
  }
  return skipped;
}

function numberOf(value: string | undefined) {
  if (value === undefined) return null;
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? null : number;
}

const fracUnit = 65536;

// Sizes are written in Doom's fixed point, though some patches give units.
function fixedOf(value: string | undefined) {
  const number = numberOf(value);
  if (number === null) return null;
  return number >= fracUnit ? Math.round(number / fracUnit) : number;
}

const countKill = 0x400000;
const special = 0x1;

function categoryOf(bits: string): CustomCategory {
  const number = /^-?\d+$/.test(bits.trim()) ? Number(bits) : null;
  if (number !== null) {
    if (number & countKill) return "enemy";
    return number & special ? "item" : "decor";
  }
  const names = new Set(bits.toUpperCase().split(/[\s+|,]+/));
  if (names.has("COUNTKILL")) return "enemy";
  return names.has("SPECIAL") ? "item" : "decor";
}

function vanillaCategory(kind: "e" | "i" | "d" | undefined): CustomCategory {
  if (kind === "e") return "enemy";
  return kind === "i" ? "item" : "decor";
}
