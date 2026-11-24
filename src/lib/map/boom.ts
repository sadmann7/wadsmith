import { defined } from "@/lib/defined";

import type { LineSides } from "./lines";
import type {
  DoorSettings,
  KeyColor,
  LineTrigger,
  Sector,
  SectorEffect,
} from "./types";

import { sectorEffects } from "./catalog";

export type GeneralizedClass =
  | "floor"
  | "ceiling"
  | "door"
  | "locked"
  | "lift"
  | "stairs"
  | "crusher";

export interface BoomField {
  id: string;
  label: string;
  shift: number;
  width: number;
  options: readonly string[];
  when?: (special: number) => boolean;
}

export interface GeneralizedKind {
  class: GeneralizedClass;
  label: string;
  target: string;
  base: number;
  end: number;
  start: number;
  fields: BoomField[];
}

export interface SectorBits {
  base: number;
  damage: number;
  secret: boolean;
  friction: boolean;
  wind: boolean;
  altDamage: boolean;
  killGrounded: boolean;
}

// Boom's generalized line specials fill 0x2F80 to 0x7FFF, each class in its
// own range, with the trigger in the low three bits of every one.
const generalizedStart = 0x2f80;
const generalizedEnd = 0x8000;
const yesNo = ["No", "Yes"] as const;
const triggerKinds: { trigger: LineTrigger; repeat: boolean }[] = [
  { trigger: "walk", repeat: false },
  { trigger: "walk", repeat: true },
  { trigger: "switch", repeat: false },
  { trigger: "switch", repeat: true },
  { trigger: "shoot", repeat: false },
  { trigger: "shoot", repeat: true },
  { trigger: "door", repeat: false },
  { trigger: "door", repeat: true },
];

const trigger: BoomField = {
  id: "trigger",
  label: "Trigger",
  shift: 0,
  width: 3,
  options: [
    "Walk over once",
    "Walk over, repeatable",
    "Use once",
    "Use, repeatable",
    "Shoot once",
    "Shoot, repeatable",
    "Use door once",
    "Use door, repeatable",
  ],
};
const speed: BoomField = {
  id: "speed",
  label: "Speed",
  shift: 3,
  width: 2,
  options: ["Slow", "Normal", "Fast", "Turbo"],
};

const changes = [
  "Nothing",
  "Texture, and clears the effect",
  "Texture only",
  "Texture and effect",
];
const models = ["The room in front of the line", "The room at the new height"];
const changeShift = 10;
const changesSomething = (special: number) =>
  ((special >> changeShift) & 3) !== 0;
const changesNothing = (special: number) => !changesSomething(special);

export const generalizedKinds: GeneralizedKind[] = [
  {
    class: "floor",
    label: "Boom floor",
    target: "Moves sector",
    base: 0x6000,
    end: 0x8000,
    start: 0x6000 | 2 | (1 << 3) | (1 << 7),
    fields: moverFields(
      [
        "Highest nearby floor",
        "Lowest nearby floor",
        "Next nearby floor",
        "Lowest nearby ceiling",
        "Its ceiling",
        "Its shortest lower texture",
        "24 away",
        "32 away",
      ],
      "floor",
    ),
  },
  {
    class: "ceiling",
    label: "Boom ceiling",
    target: "Moves sector",
    base: 0x4000,
    end: 0x6000,
    start: 0x4000 | 2 | (1 << 3) | (1 << 6),
    fields: moverFields(
      [
        "Highest nearby ceiling",
        "Lowest nearby ceiling",
        "Next nearby ceiling",
        "Highest nearby floor",
        "Its floor",
        "Its shortest upper texture",
        "24 away",
        "32 away",
      ],
      "ceiling",
    ),
  },
  {
    class: "door",
    label: "Boom door",
    target: "Opens sector",
    base: 0x3c00,
    end: 0x4000,
    start: 0x3c00 | 7 | (1 << 3) | (1 << 8),
    fields: [
      trigger,
      speed,
      choice("kind", "Door", 5, [
        "Opens, waits, closes",
        "Opens and stays",
        "Closes, waits, opens",
        "Closes and stays",
      ]),
      choice("delay", "Waits", 8, [
        "1 second",
        "4 seconds",
        "9 seconds",
        "30 seconds",
      ]),
      flag("monsters", "Monsters can trigger it", 7),
    ],
  },
  {
    class: "locked",
    label: "Boom locked door",
    target: "Opens sector",
    base: 0x3800,
    end: 0x3c00,
    start: 0x3800 | 7 | (1 << 3),
    fields: [
      trigger,
      speed,
      choice("kind", "Door", 5, ["Opens, waits, closes", "Opens and stays"]),
      choice("key", "Needs", 6, [
        "Any key",
        "Red keycard",
        "Blue keycard",
        "Yellow keycard",
        "Red skull key",
        "Blue skull key",
        "Yellow skull key",
        "Every key",
      ]),
      flag("skulls", "Skull keys count as keycards", 9),
    ],
  },
  {
    class: "lift",
    label: "Boom lift",
    target: "Moves sector",
    base: 0x3400,
    end: 0x3800,
    start: 0x3400 | 3 | (1 << 3) | (1 << 6),
    fields: [
      trigger,
      speed,
      choice("target", "Goes to", 8, [
        "Lowest nearby floor",
        "Next nearby floor",
        "Lowest nearby ceiling",
        "Up and down between nearby floors",
      ]),
      choice("delay", "Waits", 6, [
        "1 second",
        "3 seconds",
        "5 seconds",
        "10 seconds",
      ]),
      flag("monsters", "Monsters can trigger it", 5),
    ],
  },
  {
    class: "stairs",
    label: "Boom stairs",
    target: "Builds from sector",
    base: 0x3000,
    end: 0x3400,
    start: 0x3000 | 2 | (1 << 3) | (1 << 6) | (1 << 8),
    fields: [
      trigger,
      speed,
      choice("step", "Step height", 6, ["4", "8", "16", "24"]),
      choice("direction", "Builds", 8, ["Down", "Up"]),
      flag("ignore", "Keeps going past texture changes", 9),
      flag("monsters", "Monsters can trigger it", 5),
    ],
  },
  {
    class: "crusher",
    label: "Boom crusher",
    target: "Crushes in sector",
    base: 0x2f80,
    end: 0x3000,
    start: 0x2f80 | (1 << 3),
    fields: [
      trigger,
      speed,
      flag("silent", "Silent", 6),
      flag("monsters", "Monsters can trigger it", 5),
    ],
  },
];

export function getIsGeneralized(special: number) {
  return special >= generalizedStart && special < generalizedEnd;
}

export function generalizedKind(special: number) {
  return (
    generalizedKinds.find(
      (kind) => special >= kind.base && special < kind.end,
    ) ?? null
  );
}

export function generalizedClass(name: string) {
  return generalizedKinds.find((kind) => kind.class === name) ?? null;
}

export function fieldValue(special: number, field: BoomField) {
  return (special >> field.shift) & ((1 << field.width) - 1);
}

export function withField(special: number, field: BoomField, value: number) {
  const mask = ((1 << field.width) - 1) << field.shift;
  return (special & ~mask) | ((value << field.shift) & mask);
}

export function generalizedTrigger(special: number) {
  return triggerKinds[fieldValue(special, trigger)];
}

// A pressed line of these classes opens the sector behind it as a door.
export function getIsDoorClass(kind: GeneralizedKind) {
  return kind.class === "door" || kind.class === "locked";
}

// Nothing walks over or presses the back of a wall with nothing behind it,
// and a pressed door opens whatever is behind its line, so a new special
// starts as a switch where it would have nothing to cross or no door to open.
export function newGeneralized(
  kind: GeneralizedKind,
  { twoSided, doorBehind }: LineSides,
) {
  if (!twoSided) return withField(kind.start, trigger, 2);
  const option = fieldValue(kind.start, trigger);
  return getIsDoorClass(kind) &&
    triggerKinds[option].trigger === "door" &&
    !doorBehind
    ? withField(kind.start, trigger, 2 | (option & 1))
    : kind.start;
}

const lockedKeys: Record<KeyColor, number> = { red: 1, blue: 2, yellow: 3 };

// Either the keycard or the skull key of the colour opens it, as in Doom.
export function lockedDoorSpecial(
  door: Pick<DoorSettings, "closes" | "fast">,
  key: KeyColor,
) {
  const locked = defined(generalizedClass("locked"));
  const values: Record<string, number> = {
    trigger: door.closes ? 7 : 6,
    speed: door.fast ? 2 : 1,
    kind: door.closes ? 0 : 1,
    key: lockedKeys[key],
    skulls: 1,
  };
  return locked.fields.reduce(
    (special, field) => withField(special, field, values[field.id]),
    locked.base,
  );
}

export function generalizedFields(special: number) {
  const kind = generalizedKind(special);
  return kind
    ? kind.fields.filter((field) => !field.when || field.when(special))
    : [];
}

// The model bit says which room to copy from, unless nothing is copied; then
// it lets monsters trigger the line.
function moverFields(targets: string[], what: string): BoomField[] {
  return [
    trigger,
    speed,
    choice("direction", "Moves", 6, ["Down", "Up"]),
    choice("target", "Until it reaches", 7, targets),
    choice("change", `Changes the ${what}`, changeShift, changes),
    choice("model", "Copies from", 5, models, changesSomething),
    flag("monsters", "Monsters can trigger it", 5, changesNothing),
    flag("crush", "Crushes", 12),
  ];
}

function choice(
  id: string,
  label: string,
  shift: number,
  options: readonly string[],
  when?: BoomField["when"],
): BoomField {
  return { id, label, shift, width: Math.log2(options.length), options, when };
}

function flag(
  id: string,
  label: string,
  shift: number,
  when?: BoomField["when"],
): BoomField {
  return { id, label, shift, width: 1, options: yesNo, when };
}

// Boom keeps the vanilla type in the low five bits and adds damage, secret,
// friction and wind bits above it; MBF21 adds two more. A vanilla type that
// says the same as a set of bits is written the vanilla way.
const sectorTypeMask = 31;
const sectorDamageShift = 5;
const sectorSecret = 0x80;
const sectorFriction = 0x100;
const sectorWind = 0x200;
const sectorAltDamage = 0x1000;
const sectorKillGrounded = 0x2000;
const vanillaDamage = [0, 7, 5, 16];
const vanillaStrobeDamage = 4;
const vanillaSecret = 9;
const strobeFast = sectorEffects["strobe-fast"].special;
const baseEffects: SectorEffect[] = [
  "flicker",
  "blink",
  "strobe-slow",
  "strobe-fast",
  "strobe-slow-sync",
  "strobe-fast-sync",
  "glow",
  "door-close-30",
  "door-open-300",
];
export const sectorBases = baseEffects.map((effect) => ({
  value: sectorEffects[effect].special,
  label: sectorEffects[effect].label,
}));
export const damageLabels = [
  "None",
  "5% a second",
  "10% a second",
  "20% a second",
];
export const altDamageLabels = [
  "Kills without a radiation suit",
  "Kills",
  "Kills everyone and ends the level",
  "Kills everyone and goes to the secret level",
];
const specialEffects = new Map(
  Object.entries(sectorEffects).map(([effect, { special }]) => [
    special,
    effect as SectorEffect,
  ]),
);

export function sectorSpecialOf(sector: Pick<Sector, "effect" | "rawEffect">) {
  return sector.effect
    ? sectorEffects[sector.effect].special
    : (sector.rawEffect ?? 0);
}

export function sectorSpecialPatch(special: number): Partial<Sector> {
  const effect = specialEffects.get(special);
  return effect
    ? { effect, rawEffect: undefined }
    : { effect: undefined, rawEffect: special || undefined };
}

export function decodeSectorSpecial(special: number): SectorBits {
  const bits = {
    friction: Boolean(special & sectorFriction),
    wind: Boolean(special & sectorWind),
    altDamage: Boolean(special & sectorAltDamage),
    killGrounded: Boolean(special & sectorKillGrounded),
  };
  if (special > sectorTypeMask) {
    return {
      ...bits,
      base: special & sectorTypeMask,
      damage: (special >> sectorDamageShift) & 3,
      secret: Boolean(special & sectorSecret),
    };
  }
  if (special === vanillaStrobeDamage) {
    return { ...bits, base: strobeFast, damage: 3, secret: false };
  }
  if (special === vanillaSecret) {
    return { ...bits, base: 0, damage: 0, secret: true };
  }
  const damage = vanillaDamage.indexOf(special);
  return damage > 0
    ? { ...bits, base: 0, damage, secret: false }
    : { ...bits, base: special, damage: 0, secret: false };
}

export function encodeSectorSpecial(bits: SectorBits) {
  const extra =
    (bits.friction ? sectorFriction : 0) |
    (bits.wind ? sectorWind : 0) |
    (bits.altDamage ? sectorAltDamage : 0) |
    (bits.killGrounded ? sectorKillGrounded : 0);
  if (!extra && !bits.secret && bits.damage > 0) {
    if (bits.base === 0) return vanillaDamage[bits.damage];
    if (bits.base === strobeFast && bits.damage === 3) {
      return vanillaStrobeDamage;
    }
  }
  if (!extra && bits.secret && bits.damage === 0 && bits.base === 0) {
    return vanillaSecret;
  }
  return (
    bits.base |
    (bits.damage << sectorDamageShift) |
    (bits.secret ? sectorSecret : 0) |
    extra
  );
}
