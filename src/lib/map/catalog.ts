import type { KeyColor, SectorEffect, ThingCategory, ThingKind } from "./types";

export const wallTextures = [
  "STARTAN3",
  "BROWN1",
  "GRAY1",
  "METAL",
  "STONE2",
  "BRICK1",
  "TEKGREN2",
  "SLADWALL",
] as const;

export const floorTextures = [
  "FLOOR4_8",
  "FLOOR0_1",
  "FLOOR5_1",
  "FLAT1",
  "FLAT5_4",
  "GRASS1",
  "RROCK01",
] as const;

export const ceilingTextures = [
  "CEIL3_5",
  "CEIL5_1",
  "CEIL1_1",
  "TLITE6_4",
] as const;

export const doorTextures = ["BIGDOOR2", "BIGDOOR4", "DOOR1", "DOOR3"] as const;

export const switchTextures = [
  "SW1STRTN",
  "SW1GRAY",
  "SW1METAL",
  "SW1STON1",
  "SW1COMP",
] as const;

export const doorTrackTexture = "DOORTRAK";

export const sectorEffects: Record<
  SectorEffect,
  { label: string; special: number }
> = {
  flicker: { label: "Flicker", special: 17 },
  blink: { label: "Random blink", special: 1 },
  "strobe-slow": { label: "Slow strobe", special: 3 },
  "strobe-fast": { label: "Fast strobe", special: 2 },
  "strobe-slow-sync": { label: "Slow strobe in step", special: 12 },
  "strobe-fast-sync": { label: "Fast strobe in step", special: 13 },
  glow: { label: "Glow", special: 8 },
  secret: { label: "Secret", special: 9 },
  "damage-5": { label: "Damage 5%", special: 7 },
  "damage-10": { label: "Damage 10%", special: 5 },
  "damage-20": { label: "Damage 20%", special: 16 },
  "damage-20-strobe": { label: "Damage 20% with fast strobe", special: 4 },
  "damage-20-exit": {
    label: "Damage 20%, ends the level when nearly dead",
    special: 11,
  },
  "door-close-30": { label: "Closes after 30 seconds", special: 10 },
  "door-open-300": { label: "Opens after 5 minutes", special: 14 },
};

export const thingCatalog: Record<
  ThingKind,
  {
    label: string;
    doomType: number;
    color: string;
    category: ThingCategory;
    // How far below the ceiling the engine hangs it, for things that hang.
    hangs?: number;
    // Doom II added it, so a Doom 1 game has no such thing.
    doom2?: boolean;
  }
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
    doom2: true,
    color: "#ef4444",
    category: "enemy",
  },
  "pain-elemental": {
    label: "Pain elemental",
    doomType: 71,
    doom2: true,
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
  cacodemon: {
    label: "Cacodemon",
    doomType: 3005,
    color: "#f87171",
    category: "enemy",
  },
  "hell-knight": {
    label: "Hell knight",
    doomType: 69,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  "baron-of-hell": {
    label: "Baron of Hell",
    doomType: 3003,
    color: "#f87171",
    category: "enemy",
  },
  arachnotron: {
    label: "Arachnotron",
    doomType: 68,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  revenant: {
    label: "Revenant",
    doomType: 66,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  mancubus: {
    label: "Mancubus",
    doomType: 67,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  "arch-vile": {
    label: "Arch-vile",
    doomType: 64,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  "spider-mastermind": {
    label: "Spider Mastermind",
    doomType: 7,
    color: "#f87171",
    category: "enemy",
  },
  cyberdemon: {
    label: "Cyberdemon",
    doomType: 16,
    color: "#f87171",
    category: "enemy",
  },
  "wolfenstein-ss": {
    label: "Wolfenstein SS",
    doomType: 84,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  "commander-keen": {
    label: "Commander Keen",
    doomType: 72,
    doom2: true,
    color: "#f87171",
    category: "enemy",
    hangs: 72,
  },
  "boss-brain": {
    label: "Boss brain",
    doomType: 88,
    doom2: true,
    color: "#f87171",
    category: "enemy",
  },
  chainsaw: {
    label: "Chainsaw",
    doomType: 2005,
    color: "#facc15",
    category: "item",
  },
  "super-shotgun": {
    label: "Super shotgun",
    doomType: 82,
    doom2: true,
    color: "#facc15",
    category: "item",
  },
  "rocket-launcher": {
    label: "Rocket launcher",
    doomType: 2003,
    color: "#facc15",
    category: "item",
  },
  "plasma-gun": {
    label: "Plasma gun",
    doomType: 2004,
    color: "#facc15",
    category: "item",
  },
  "bfg-9000": {
    label: "BFG 9000",
    doomType: 2006,
    color: "#facc15",
    category: "item",
  },
  "box-of-bullets": {
    label: "Box of bullets",
    doomType: 2048,
    color: "#facc15",
    category: "item",
  },
  "box-of-shells": {
    label: "Box of shells",
    doomType: 2049,
    color: "#facc15",
    category: "item",
  },
  rocket: {
    label: "Rocket",
    doomType: 2010,
    color: "#facc15",
    category: "item",
  },
  "box-of-rockets": {
    label: "Box of rockets",
    doomType: 2046,
    color: "#facc15",
    category: "item",
  },
  cell: {
    label: "Cell",
    doomType: 2047,
    color: "#facc15",
    category: "item",
  },
  "cell-pack": {
    label: "Cell pack",
    doomType: 17,
    color: "#facc15",
    category: "item",
  },
  backpack: {
    label: "Backpack",
    doomType: 8,
    color: "#facc15",
    category: "item",
  },
  "health-bonus": {
    label: "Health bonus",
    doomType: 2014,
    color: "#60a5fa",
    category: "item",
  },
  soulsphere: {
    label: "Soulsphere",
    doomType: 2013,
    color: "#60a5fa",
    category: "item",
  },
  megasphere: {
    label: "Megasphere",
    doomType: 83,
    doom2: true,
    color: "#60a5fa",
    category: "item",
  },
  "armor-bonus": {
    label: "Armor bonus",
    doomType: 2015,
    color: "#60a5fa",
    category: "item",
  },
  invulnerability: {
    label: "Invulnerability",
    doomType: 2022,
    color: "#60a5fa",
    category: "item",
  },
  berserk: {
    label: "Berserk",
    doomType: 2023,
    color: "#60a5fa",
    category: "item",
  },
  "partial-invisibility": {
    label: "Partial invisibility",
    doomType: 2024,
    color: "#60a5fa",
    category: "item",
  },
  "radiation-suit": {
    label: "Radiation suit",
    doomType: 2025,
    color: "#60a5fa",
    category: "item",
  },
  "computer-map": {
    label: "Computer map",
    doomType: 2026,
    color: "#60a5fa",
    category: "item",
  },
  "light-amplification": {
    label: "Light amplification",
    doomType: 2045,
    color: "#60a5fa",
    category: "item",
  },
  "blue-skull-key": {
    label: "Blue skull key",
    doomType: 40,
    color: "#3b82f6",
    category: "key",
  },
  "yellow-skull-key": {
    label: "Yellow skull key",
    doomType: 39,
    color: "#eab308",
    category: "key",
  },
  "red-skull-key": {
    label: "Red skull key",
    doomType: 38,
    color: "#ef4444",
    category: "key",
  },
  "burning-barrel": {
    label: "Burning barrel",
    doomType: 70,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "tall-tech-lamp": {
    label: "Tall tech lamp",
    doomType: 85,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "short-tech-lamp": {
    label: "Short tech lamp",
    doomType: 86,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  candle: {
    label: "Candle",
    doomType: 34,
    color: "#9ca3af",
    category: "decor",
  },
  candelabra: {
    label: "Candelabra",
    doomType: 35,
    color: "#9ca3af",
    category: "decor",
  },
  "tall-blue-torch": {
    label: "Tall blue torch",
    doomType: 44,
    color: "#9ca3af",
    category: "decor",
  },
  "tall-green-torch": {
    label: "Tall green torch",
    doomType: 45,
    color: "#9ca3af",
    category: "decor",
  },
  "short-blue-torch": {
    label: "Short blue torch",
    doomType: 55,
    color: "#9ca3af",
    category: "decor",
  },
  "short-green-torch": {
    label: "Short green torch",
    doomType: 56,
    color: "#9ca3af",
    category: "decor",
  },
  "short-red-torch": {
    label: "Short red torch",
    doomType: 57,
    color: "#9ca3af",
    category: "decor",
  },
  "tall-green-pillar": {
    label: "Tall green pillar",
    doomType: 30,
    color: "#9ca3af",
    category: "decor",
  },
  "short-green-pillar": {
    label: "Short green pillar",
    doomType: 31,
    color: "#9ca3af",
    category: "decor",
  },
  "tall-red-pillar": {
    label: "Tall red pillar",
    doomType: 32,
    color: "#9ca3af",
    category: "decor",
  },
  "short-red-pillar": {
    label: "Short red pillar",
    doomType: 33,
    color: "#9ca3af",
    category: "decor",
  },
  "heart-pillar": {
    label: "Pillar with heart",
    doomType: 36,
    color: "#9ca3af",
    category: "decor",
  },
  "skull-pillar": {
    label: "Pillar with skull",
    doomType: 37,
    color: "#9ca3af",
    category: "decor",
  },
  "brown-stump": {
    label: "Brown stump",
    doomType: 47,
    color: "#9ca3af",
    category: "decor",
  },
  "burnt-tree": {
    label: "Burnt tree",
    doomType: 43,
    color: "#9ca3af",
    category: "decor",
  },
  "big-tree": {
    label: "Big tree",
    doomType: 54,
    color: "#9ca3af",
    category: "decor",
  },
  "evil-eye": {
    label: "Evil eye",
    doomType: 41,
    color: "#9ca3af",
    category: "decor",
  },
  "floating-skulls": {
    label: "Floating skulls",
    doomType: 42,
    color: "#9ca3af",
    category: "decor",
  },
  "bloody-mess": {
    label: "Bloody mess",
    doomType: 10,
    color: "#9ca3af",
    category: "decor",
  },
  "bloody-mess-2": {
    label: "Bloody mess, second",
    doomType: 12,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-player": {
    label: "Dead player",
    doomType: 15,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-zombieman": {
    label: "Dead zombieman",
    doomType: 18,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-shotgun-guy": {
    label: "Dead shotgun guy",
    doomType: 19,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-imp": {
    label: "Dead imp",
    doomType: 20,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-demon": {
    label: "Dead demon",
    doomType: 21,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-cacodemon": {
    label: "Dead cacodemon",
    doomType: 22,
    color: "#9ca3af",
    category: "decor",
  },
  "dead-lost-soul": {
    label: "Dead lost soul",
    doomType: 23,
    color: "#9ca3af",
    category: "decor",
  },
  "pool-of-blood-and-flesh": {
    label: "Pool of blood and flesh",
    doomType: 24,
    color: "#9ca3af",
    category: "decor",
  },
  "impaled-human": {
    label: "Impaled human",
    doomType: 25,
    color: "#9ca3af",
    category: "decor",
  },
  "twitching-impaled-human": {
    label: "Twitching impaled human",
    doomType: 26,
    color: "#9ca3af",
    category: "decor",
  },
  "skull-on-pole": {
    label: "Skull on a pole",
    doomType: 27,
    color: "#9ca3af",
    category: "decor",
  },
  "skulls-on-pole": {
    label: "Skulls on a pole",
    doomType: 28,
    color: "#9ca3af",
    category: "decor",
  },
  "pile-of-skulls": {
    label: "Pile of skulls",
    doomType: 29,
    color: "#9ca3af",
    category: "decor",
  },
  "hanging-victim-twitching": {
    label: "Hanging victim, twitching",
    doomType: 49,
    color: "#9ca3af",
    category: "decor",
    hangs: 68,
  },
  "hanging-victim-arms-out": {
    label: "Hanging victim, arms out",
    doomType: 50,
    color: "#9ca3af",
    category: "decor",
    hangs: 84,
  },
  "hanging-victim-one-leg": {
    label: "Hanging victim, one leg",
    doomType: 51,
    color: "#9ca3af",
    category: "decor",
    hangs: 84,
  },
  "hanging-legs": {
    label: "Hanging pair of legs",
    doomType: 52,
    color: "#9ca3af",
    category: "decor",
    hangs: 68,
  },
  "hanging-leg": {
    label: "Hanging leg",
    doomType: 53,
    color: "#9ca3af",
    category: "decor",
    hangs: 52,
  },
  "hanging-victim-arms-out-2": {
    label: "Hanging victim, arms out, passable",
    doomType: 59,
    color: "#9ca3af",
    category: "decor",
    hangs: 84,
  },
  "hanging-legs-2": {
    label: "Hanging pair of legs, passable",
    doomType: 60,
    color: "#9ca3af",
    category: "decor",
    hangs: 68,
  },
  "hanging-victim-one-leg-2": {
    label: "Hanging victim, one leg, passable",
    doomType: 61,
    color: "#9ca3af",
    category: "decor",
    hangs: 52,
  },
  "hanging-leg-2": {
    label: "Hanging leg, passable",
    doomType: 62,
    color: "#9ca3af",
    category: "decor",
    hangs: 52,
  },
  "hanging-victim-twitching-2": {
    label: "Hanging victim, twitching, passable",
    doomType: 63,
    color: "#9ca3af",
    category: "decor",
    hangs: 68,
  },
  "hanging-victim-guts": {
    label: "Hanging victim, guts removed",
    doomType: 73,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
    hangs: 88,
  },
  "hanging-victim-guts-brain": {
    label: "Hanging victim, guts and brain removed",
    doomType: 74,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
    hangs: 88,
  },
  "hanging-torso-looking-down": {
    label: "Hanging torso, looking down",
    doomType: 75,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
    hangs: 64,
  },
  "hanging-torso-open-skull": {
    label: "Hanging torso, open skull",
    doomType: 76,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
    hangs: 64,
  },
  "hanging-torso-looking-up": {
    label: "Hanging torso, looking up",
    doomType: 77,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
    hangs: 64,
  },
  "hanging-torso-brain-removed": {
    label: "Hanging torso, brain removed",
    doomType: 78,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
    hangs: 64,
  },
  "pool-of-blood": {
    label: "Pool of blood",
    doomType: 79,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "pool-of-blood-2": {
    label: "Pool of blood, small",
    doomType: 80,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "pool-of-brains": {
    label: "Pool of brains",
    doomType: 81,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "boss-shooter": {
    label: "Monster spawner",
    doomType: 89,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "spawn-spot": {
    label: "Spawn spot",
    doomType: 87,
    doom2: true,
    color: "#9ca3af",
    category: "decor",
  },
  "teleport-destination": {
    label: "Teleport destination",
    doomType: 14,
    color: "#9ca3af",
    category: "decor",
  },
};

// A keycard and a skull key of one color open the same doors.
export const keyThings: Record<KeyColor, ThingKind[]> = {
  blue: ["blue-key", "blue-skull-key"],
  yellow: ["yellow-key", "yellow-skull-key"],
  red: ["red-key", "red-skull-key"],
};

export const thingKinds = Object.keys(thingCatalog) as ThingKind[];

// Vanilla Doom stops loading a deathmatch with fewer deathmatch starts than this.
export const deathmatchStarts = 4;

// The kinds a thing can change to: any of its own category, but a player
// start stays what it is.
export function swappableKinds(kind: ThingKind) {
  const { category } = thingCatalog[kind];
  return category === "start"
    ? []
    : thingKinds.filter((item) => thingCatalog[item].category === category);
}

// A map has one of each player start, but any number of deathmatch starts.
export function getIsPlayerStart(kind: ThingKind) {
  return thingCatalog[kind].category === "start" && kind !== "deathmatch-start";
}
