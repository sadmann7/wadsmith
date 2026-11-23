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
}

interface ThingPatch {
  number: number;
  name: string | null;
  fields: Map<string, string>;
}

const fullBright = 0x8000;
const blockHeader =
  /^(thing|frame|pointer|sound|ammo|weapon|cheat|misc|sprite)\s+(\d+)\s*(?:\((.*)\))?\s*$/i;

// The things a DEHACKED or BEX patch gives editor numbers of their own, with
// what a map editor needs to show them. Anything else in it is left alone.
// A map stores editor numbers as signed 16-bit values.
const typeLimit = 32767;

export function parseDehacked(text: string): CustomThing[] {
  const things = new Map<number, ThingPatch>();
  const frames = new Map<number, Map<string, string>>();
  const renamed = new Map<number, string>();
  let fields: Map<string, string> | null = null;
  let section: string | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
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
        const known = things.get(number);
        const name = header[3]?.trim() || known?.name || null;
        fields = known?.fields ?? new Map();
        things.set(number, { number, name, fields });
      } else if (kind === "frame") {
        fields = frames.get(number) ?? new Map();
        frames.set(number, fields);
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
    } else if (fields) {
      fields.set(key, pair[2].trim());
    }
  }

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

  return [...things.values()].flatMap(({ number, name, fields: thing }) => {
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
      },
    ];
  });
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
