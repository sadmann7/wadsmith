import type { KeyColor, SectorEffect, ThingCategory, ThingKind } from "./types";

const wallTextures = [
  "STARTAN3",
  "BROWN1",
  "GRAY1",
  "METAL",
  "STONE2",
  "BRICK1",
  "TEKGREN2",
  "SLADWALL",
] as const;

const floorTextures = [
  "FLOOR4_8",
  "FLOOR0_1",
  "FLOOR5_1",
  "FLAT1",
  "FLAT5_4",
  "GRASS1",
  "RROCK01",
] as const;

const ceilingTextures = ["CEIL3_5", "CEIL5_1", "CEIL1_1", "TLITE6_4"] as const;

const doorTextures = ["BIGDOOR2", "BIGDOOR4", "DOOR1", "DOOR3"] as const;

const switchTextures = [
  "SW1STRTN",
  "SW1GRAY",
  "SW1METAL",
  "SW1STON1",
  "SW1COMP",
] as const;

const doorTrackTexture = "DOORTRAK";

const sectorEffects: Record<SectorEffect, { label: string; special: number }> =
  {
    flicker: { label: "Flicker", special: 17 },
    blink: { label: "Random blink", special: 1 },
    "strobe-slow": { label: "Slow strobe", special: 3 },
    "strobe-fast": { label: "Fast strobe", special: 2 },
    glow: { label: "Glow", special: 8 },
    secret: { label: "Secret", special: 9 },
    "damage-5": { label: "Damage 5%", special: 7 },
    "damage-10": { label: "Damage 10%", special: 5 },
    "damage-20": { label: "Damage 20%", special: 16 },
  };

const thingCatalog: Record<
  ThingKind,
  { label: string; doomType: number; color: string; category: ThingCategory }
> = {
  player: {
    label: "Player start",
    doomType: 1,
    color: "#4ade80",
    category: "start",
  },
  "player-2": {
    label: "Player 2 start",
    doomType: 2,
    color: "#4ade80",
    category: "start",
  },
  "player-3": {
    label: "Player 3 start",
    doomType: 3,
    color: "#4ade80",
    category: "start",
  },
  "player-4": {
    label: "Player 4 start",
    doomType: 4,
    color: "#4ade80",
    category: "start",
  },
  "deathmatch-start": {
    label: "Deathmatch start",
    doomType: 11,
    color: "#4ade80",
    category: "start",
  },
  imp: { label: "Imp", doomType: 3001, color: "#fb923c", category: "enemy" },
  zombieman: {
    label: "Zombieman",
    doomType: 3004,
    color: "#f87171",
    category: "enemy",
  },
  "shotgun-guy": {
    label: "Shotgun guy",
    doomType: 9,
    color: "#fb7185",
    category: "enemy",
  },
  demon: {
    label: "Demon",
    doomType: 3002,
    color: "#f472b6",
    category: "enemy",
  },
  spectre: {
    label: "Spectre",
    doomType: 58,
    color: "#c084fc",
    category: "enemy",
  },
  "lost-soul": {
    label: "Lost soul",
    doomType: 3006,
    color: "#fdba74",
    category: "enemy",
  },
  chaingunner: {
    label: "Chaingunner",
    doomType: 65,
    color: "#ef4444",
    category: "enemy",
  },
  "pain-elemental": {
    label: "Pain elemental",
    doomType: 71,
    color: "#a16207",
    category: "enemy",
  },
  shotgun: {
    label: "Shotgun",
    doomType: 2001,
    color: "#facc15",
    category: "item",
  },
  chaingun: {
    label: "Chaingun",
    doomType: 2002,
    color: "#eab308",
    category: "item",
  },
  clip: { label: "Clip", doomType: 2007, color: "#d9f99d", category: "item" },
  shells: {
    label: "Shells",
    doomType: 2008,
    color: "#fde68a",
    category: "item",
  },
  stimpack: {
    label: "Stimpack",
    doomType: 2011,
    color: "#93c5fd",
    category: "item",
  },
  medikit: {
    label: "Medikit",
    doomType: 2012,
    color: "#60a5fa",
    category: "item",
  },
  "green-armor": {
    label: "Green armor",
    doomType: 2018,
    color: "#4ade80",
    category: "item",
  },
  "blue-armor": {
    label: "Blue armor",
    doomType: 2019,
    color: "#38bdf8",
    category: "item",
  },
  "blue-key": {
    label: "Blue key",
    doomType: 5,
    color: "#3b82f6",
    category: "key",
  },
  "yellow-key": {
    label: "Yellow key",
    doomType: 6,
    color: "#eab308",
    category: "key",
  },
  "red-key": {
    label: "Red key",
    doomType: 13,
    color: "#ef4444",
    category: "key",
  },
  barrel: {
    label: "Barrel",
    doomType: 2035,
    color: "#84cc16",
    category: "decor",
  },
  lamp: {
    label: "Floor lamp",
    doomType: 2028,
    color: "#e5e7eb",
    category: "decor",
  },
  "tech-column": {
    label: "Tech column",
    doomType: 48,
    color: "#9ca3af",
    category: "decor",
  },
  "red-torch": {
    label: "Red torch",
    doomType: 46,
    color: "#f97316",
    category: "decor",
  },
};

const keyThings: Record<KeyColor, ThingKind> = {
  blue: "blue-key",
  yellow: "yellow-key",
  red: "red-key",
};

const thingKinds = Object.keys(thingCatalog) as ThingKind[];

// Vanilla Doom stops loading a deathmatch with fewer deathmatch starts than this.
const deathmatchStarts = 4;

// A map has one of each player start, but any number of deathmatch starts.
function isPlayerStart(kind: ThingKind) {
  return thingCatalog[kind].category === "start" && kind !== "deathmatch-start";
}

export {
  ceilingTextures,
  doorTextures,
  doorTrackTexture,
  deathmatchStarts,
  floorTextures,
  isPlayerStart,
  keyThings,
  sectorEffects,
  switchTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
};
