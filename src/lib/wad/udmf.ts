import { getIsGeneralized } from "@/lib/map/boom";
import {
  doomActionFor,
  doomSectorSpecialFor,
  hexenSpecialName,
  type HexenTrigger,
} from "@/lib/map/hexen-actions";

import type { DoomLine, DoomMap, DoomSector, DoomThing } from "./read-map";

import { WadFileError } from "./inspect";

export interface UdmfImport {
  namespace: string;
  droppedFields: Record<string, number>;
  droppedActions: Record<string, number>;
}

interface Fields {
  int: (key: string, fallback?: number) => number;
  word: (key: string, fallback: number) => number;
  coordinate: (key: string) => number;
  special: (key: string) => number;
  tag: (key: string) => number;
  flag: (key: string) => boolean;
  texture: (key: string) => string;
  index: (key: string) => number;
  side: (key: string) => number | null;
  use: (keys: string[]) => void;
}

const lineFlags: [string, number][] = [
  ["blocking", 0x0001],
  ["blockmonsters", 0x0002],
  ["twosided", 0x0004],
  ["dontpegtop", 0x0008],
  ["dontpegbottom", 0x0010],
  ["secret", 0x0020],
  ["blocksound", 0x0040],
  ["dontdraw", 0x0080],
  ["mapped", 0x0100],
  ["passuse", 0x0200],
];

const thingFlags: [string, number][] = [
  ["skill1", 0x0001],
  ["skill2", 0x0001],
  ["skill3", 0x0002],
  ["skill4", 0x0004],
  ["skill5", 0x0004],
  ["ambush", 0x0008],
  ["friend", 0x0080],
];

const kept: Record<string, Set<string>> = {
  vertex: new Set(["x", "y"]),
  linedef: new Set([
    "v1",
    "v2",
    "sidefront",
    "sideback",
    ...lineFlags.map(([flag]) => flag),
  ]),
  sidedef: new Set([
    "offsetx",
    "offsety",
    "texturetop",
    "texturebottom",
    "texturemiddle",
    "sector",
  ]),
  sector: new Set([
    "heightfloor",
    "heightceiling",
    "texturefloor",
    "textureceiling",
    "lightlevel",
    "id",
  ]),
  thing: new Set([
    "x",
    "y",
    "angle",
    "type",
    "single",
    "coop",
    "dm",
    ...thingFlags.map(([flag]) => flag),
  ]),
};

export function readTextmap(slot: string, source: string): DoomMap {
  const { namespace, globals, blocks } = parseTextmap(source);
  const droppedFields: Record<string, number> = {};
  const droppedActions: Record<string, number> = {};
  for (const key of globals.keys()) drop(droppedFields, key);
  const read = <T>(kind: string, build: (fields: Fields) => T) =>
    blocks
      .filter((block) => block.kind === kind)
      .map((block) => {
        const used = new Set(["comment", ...kept[kind]]);
        const record = build(fieldsOf(block, used));
        for (const [key, value] of block.fields) {
          if (!used.has(key) && !getIsDefault(value)) {
            drop(droppedFields, `${kind}.${key}`);
          }
        }
        return record;
      });
  for (const block of blocks) {
    if (!(block.kind in kept)) drop(droppedFields, block.kind);
  }

  const vertices = read("vertex", (vertex) => ({
    x: vertex.coordinate("x"),
    y: vertex.coordinate("y"),
  }));
  const sides = read("sidedef", (side) => ({
    offsetX: side.word("offsetx", 0),
    offsetY: side.word("offsety", 0),
    upper: side.texture("texturetop"),
    lower: side.texture("texturebottom"),
    middle: side.texture("texturemiddle"),
    sector: side.index("sector"),
  }));
  const inRange = (side: number | null) =>
    side !== null && side < sides.length ? side : null;
  const lines = read("linedef", (line): DoomLine => {
    const action = readLineAction(namespace, line);
    line.use(action.used);
    if (action.dropped) drop(droppedActions, action.dropped);
    return {
      start: line.index("v1"),
      end: line.index("v2"),
      flags: lineFlags.reduce(
        (sum, [flag, bit]) => (line.flag(flag) ? sum | bit : sum),
        0,
      ),
      special: action.special,
      tag: action.tag,
      front: inRange(line.side("sidefront")),
      back: inRange(line.side("sideback")),
      ...(action.nearest ? { approximates: action.nearest } : {}),
    };
  });
  const sectors = read("sector", (sector): DoomSector => {
    const effect = readSectorSpecial(namespace, sector);
    sector.use(effect.used);
    return {
      floor: sector.word("heightfloor", 0),
      ceiling: sector.word("heightceiling", 0),
      floorTexture: sector.texture("texturefloor"),
      ceilingTexture: sector.texture("textureceiling"),
      light: sector.word("lightlevel", 160),
      special: effect.special,
      tag: sector.tag("id"),
    };
  });
  const things = read("thing", (thing): DoomThing => {
    const skills = thingFlags.reduce(
      (sum, [flag, bit]) => (thing.flag(flag) ? sum | bit : sum),
      0,
    );
    return {
      x: thing.coordinate("x"),
      y: thing.coordinate("y"),
      angle: thing.int("angle", 0),
      type: thing.int("type"),
      flags:
        skills |
        (thing.flag("single") ? 0 : 0x0010) |
        (thing.flag("dm") ? 0 : 0x0020) |
        (thing.flag("coop") ? 0 : 0x0040),
    };
  });
  return {
    slot,
    vertices,
    lines,
    sides,
    sectors,
    things,
    udmf: { namespace, droppedFields, droppedActions },
  };
}

function drop(into: Record<string, number>, key: string) {
  into[key] = (into[key] ?? 0) + 1;
}

type Value =
  | { type: "int"; value: number }
  | { type: "float"; value: number }
  | { type: "string"; value: string }
  | { type: "keyword"; value: string };

interface Block {
  kind: string;
  index: number;
  fields: Map<string, Value>;
}

interface Token {
  text: string;
  at: number;
  value: Value | null;
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseTextmap(source: string) {
  const tokens = tokenize(source);
  const globals = new Map<string, Value>();
  const blocks: Block[] = [];
  const counts = new Map<string, number>();
  let index = 0;
  const end = source.length;
  const expect = (text: string) => {
    const token = tokens[index];
    if (token?.text !== text || token.value?.type === "string") {
      fail(source, token?.at ?? end, `expects "${text}"`);
    }
    index += 1;
  };
  const name = () => {
    const token = tokens[index];
    if (!token || token.value === null || !identifier.test(token.text)) {
      fail(source, token?.at ?? end, "expects a field or block name");
    }
    index += 1;
    return token.text.toLowerCase();
  };
  const assignment = (into: Map<string, Value>, key: string) => {
    expect("=");
    const token = tokens[index];
    if (!token?.value)
      fail(source, token?.at ?? end, `expects a value for ${key}`);
    index += 1;
    expect(";");
    into.set(key, token.value);
  };
  while (index < tokens.length) {
    const key = name();
    if (tokens[index]?.text === "=") {
      assignment(globals, key);
      continue;
    }
    expect("{");
    const fields = new Map<string, Value>();
    while (tokens[index]?.text !== "}") {
      if (index >= tokens.length) fail(source, end, `never closes a ${key}`);
      assignment(fields, name());
    }
    index += 1;
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    blocks.push({ kind: key, index: count, fields });
  }
  const namespace = globals.get("namespace");
  if (namespace?.type !== "string") {
    throw new WadFileError("Its TEXTMAP doesn't name a namespace.");
  }
  globals.delete("namespace");
  return { namespace: namespace.value.toLowerCase(), globals, blocks };
}

const tokenPattern =
  /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(\/\*)|"((?:[^"\\]|\\[\s\S])*)"|(")|([{}=;])|((?:[^{}();"'\s=/]|\/(?![/*]))+)/y;

function tokenize(source: string) {
  const tokens: Token[] = [];
  tokenPattern.lastIndex = 0;
  while (tokenPattern.lastIndex < source.length) {
    const at = tokenPattern.lastIndex;
    const match = tokenPattern.exec(source);
    if (!match) fail(source, at, "can't be read");
    const [, openComment, quoted, openQuote, punctuation, word] = match;
    if (openComment !== undefined)
      fail(source, at, "has a comment that never ends");
    if (openQuote !== undefined)
      fail(source, at, "has a string that never ends");
    if (quoted !== undefined) {
      tokens.push({
        text: quoted,
        at,
        value: { type: "string", value: quoted.replace(/\\([\s\S])/g, "$1") },
      });
    } else if (punctuation !== undefined) {
      tokens.push({ text: punctuation, at, value: null });
    } else if (word !== undefined) {
      tokens.push({ text: word, at, value: valueOf(word) });
    }
  }
  return tokens;
}

const decimal = /^[+-]?(?:0|[1-9][0-9]*)$/;
const octal = /^[+-]?0[0-7]+$/;
const hex = /^0x[0-9A-Fa-f]+$/i;
const float = /^[+-]?[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?$/;

function valueOf(word: string): Value {
  if (hex.test(word)) return { type: "int", value: Number.parseInt(word, 16) };
  if (octal.test(word)) return { type: "int", value: Number.parseInt(word, 8) };
  if (decimal.test(word)) return { type: "int", value: Number(word) };
  if (float.test(word)) return { type: "float", value: Number(word) };
  return { type: "keyword", value: word.toLowerCase() };
}

function fail(source: string, at: number, problem: string): never {
  const line = source.slice(0, at).split("\n").length;
  throw new WadFileError(`Its TEXTMAP ${problem} on line ${line}.`);
}

const doomSpecials = new Set(["doom", "woof", "zdoomtranslated"]);
const hexenSpecials = new Set([
  "zdoom",
  "dsda",
  "eternity",
  "hexen",
  "vavoom",
  "k8vavoom",
  "helion",
]);

const hexenLineFields = [
  "special",
  "arg0",
  "arg1",
  "arg2",
  "arg3",
  "arg4",
  "repeatspecial",
  "playercross",
  "playeruse",
  "monstercross",
  "impact",
  "monsteruse",
  "playerpush",
  "monsterpush",
  "missilecross",
  "anycross",
];

const playerTriggers = ["playeruse", "impact", "playercross"];

interface LineAction {
  special: number;
  tag: number;
  used: string[];
  dropped?: string;
  nearest?: string;
}

// The one place that turns a line's special, args and id into a Doom special
// and tag. Namespaces with Doom specials carry the tag in arg0 and the line's
// own identity in id, which the classic format keeps as one number.
function readLineAction(namespace: string, line: Fields): LineAction {
  const special = line.special("special");
  const id = line.tag("id");
  if (doomSpecials.has(namespace)) {
    const arg0 = line.tag("arg0");
    return {
      special,
      tag: special === 0 ? id : arg0,
      used: [
        "special",
        "arg0",
        ...(special !== 0 && id !== 0 && id !== arg0 ? [] : ["id"]),
      ],
    };
  }
  const keepId = (tag: number) =>
    id === 0 || id === tag ? [...hexenLineFields, "id"] : hexenLineFields;
  if (special === 0) return { special: 0, tag: id, used: keepId(id) };
  if (!hexenSpecials.has(namespace)) {
    return {
      special: 0,
      tag: id,
      used: keepId(id),
      dropped: `Actions from ${namespace} maps`,
    };
  }
  const trigger = readTrigger(line);
  const action =
    trigger &&
    doomActionFor({
      special,
      id,
      args: [0, 1, 2, 3, 4].map((arg) => line.tag(`arg${arg}`)),
      trigger,
      repeat: line.flag("repeatspecial"),
      monsters:
        line.flag("monsteractivate") ||
        (trigger === "use"
          ? line.flag("monsteruse")
          : trigger === "walk" &&
            (line.flag("monstercross") || line.flag("anycross"))),
    });
  if (!action) {
    return {
      special: 0,
      tag: id,
      used: keepId(id),
      dropped: hexenSpecialName(special),
    };
  }
  const triggers = playerTriggers.filter((key) => line.flag(key)).length;
  // GZDoom gives a Boom line that monsters can walk over anycross, which also
  // lets missiles through; only a generalized special says the same.
  const anyCross =
    line.flag("anycross") &&
    !line.flag("playercross") &&
    !getIsGeneralized(action.special);
  return {
    special: action.special,
    tag: action.tag,
    used: [
      ...keepId(action.tag),
      ...(getIsGeneralized(action.special) ? ["monsteractivate"] : []),
    ],
    ...(action.isNearest || triggers > 1 || anyCross
      ? { nearest: hexenSpecialName(special) }
      : {}),
  };
}

const otherTriggers = [
  "monsteruse",
  "playerpush",
  "monsterpush",
  "missilecross",
];

function readTrigger(line: Fields): HexenTrigger | null {
  if (line.flag("playeruse")) return "use";
  if (line.flag("impact")) return "shoot";
  if (line.flag("playercross") || line.flag("anycross")) return "walk";
  if (line.flag("monstercross")) return "monster-walk";
  return otherTriggers.some((key) => line.flag(key)) ? null : "none";
}

function readSectorSpecial(namespace: string, sector: Fields) {
  const special = sector.special("special");
  if (doomSpecials.has(namespace)) return { special, used: ["special"] };
  const doom = hexenSpecials.has(namespace)
    ? doomSectorSpecialFor(special)
    : null;
  return doom === null
    ? { special: 0, used: [] }
    : { special: doom, used: ["special"] };
}

const wordRange = "between -32767 and 32767";

function fieldsOf(block: Block, used: Set<string>): Fields {
  const label = `${block.kind} ${block.index}`;
  const get = (key: string) => block.fields.get(key);
  const wrong = (key: string, expected: string): never => {
    throw new WadFileError(
      `Its TEXTMAP gives ${label} a ${key} that isn't ${expected}.`,
    );
  };
  const missing = (key: string): never => {
    throw new WadFileError(`Its TEXTMAP gives ${label} no ${key}.`);
  };
  const int = (key: string, fallback?: number) => {
    const value = get(key);
    if (value === undefined) return fallback ?? missing(key);
    return value.type === "int" ? value.value : wrong(key, "a whole number");
  };
  return {
    int,
    word: (key, fallback) => {
      const value = int(key, fallback);
      return getIsWord(value) ? value : wrong(key, wordRange);
    },
    coordinate: (key) => {
      const value = get(key) ?? missing(key);
      if (value.type !== "int" && value.type !== "float") {
        return wrong(key, "a number");
      }
      const rounded = Math.round(value.value) || 0;
      return getIsWord(rounded) ? rounded : wrong(key, wordRange);
    },
    special: (key) => {
      const value = int(key, 0);
      return value >= 0 && value <= 32767
        ? value
        : wrong(key, "between 0 and 32767");
    },
    tag: (key) => {
      const value = Math.max(int(key, 0), 0);
      return value <= 0xffff ? value : wrong(key, "between 0 and 65535");
    },
    flag: (key) => {
      const value = get(key);
      if (value === undefined) return false;
      if (value.type === "keyword" && value.value === "true") return true;
      if (value.type === "keyword" && value.value === "false") return false;
      return wrong(key, "true or false");
    },
    texture: (key) => {
      const value = get(key);
      if (value === undefined) return "-";
      return value.type === "string"
        ? value.value.toUpperCase()
        : wrong(key, "a quoted name");
    },
    index: (key) => {
      const value = int(key);
      return value >= 0 ? value : wrong(key, "zero or more");
    },
    side: (key) => {
      const value = int(key, -1);
      return value < 0 ? null : value;
    },
    use: (keys) => {
      for (const key of keys) used.add(key);
    },
  };
}

function getIsWord(value: number) {
  return Math.abs(value) <= 32767;
}

function getIsDefault(value: Value) {
  return (
    (value.type === "keyword" && value.value === "false") ||
    ((value.type === "int" || value.type === "float") && value.value === 0)
  );
}
