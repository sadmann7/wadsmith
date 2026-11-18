import type { KeyColor, SectorEffect, ThingKind } from "./types";

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
  { label: string; doomType: number; color: string; monster: boolean }
> = {
  player: {
    label: "Player start",
    doomType: 1,
    color: "#4ade80",
    monster: false,
  },
  zombieman: {
    label: "Zombieman",
    doomType: 3004,
    color: "#f87171",
    monster: true,
  },
  "shotgun-guy": {
    label: "Shotgun guy",
    doomType: 9,
    color: "#fb7185",
    monster: true,
  },
  imp: { label: "Imp", doomType: 3001, color: "#fb923c", monster: true },
  demon: { label: "Demon", doomType: 3002, color: "#f472b6", monster: true },
  shotgun: {
    label: "Shotgun",
    doomType: 2001,
    color: "#facc15",
    monster: false,
  },
  shells: { label: "Shells", doomType: 2008, color: "#fde68a", monster: false },
  medikit: {
    label: "Medikit",
    doomType: 2012,
    color: "#60a5fa",
    monster: false,
  },
  "blue-key": {
    label: "Blue key",
    doomType: 5,
    color: "#3b82f6",
    monster: false,
  },
  "yellow-key": {
    label: "Yellow key",
    doomType: 6,
    color: "#eab308",
    monster: false,
  },
  "red-key": {
    label: "Red key",
    doomType: 13,
    color: "#ef4444",
    monster: false,
  },
};

const keyThings: Record<KeyColor, ThingKind> = {
  blue: "blue-key",
  yellow: "yellow-key",
  red: "red-key",
};

const thingKinds = Object.keys(thingCatalog) as ThingKind[];

export {
  ceilingTextures,
  doorTextures,
  doorTrackTexture,
  floorTextures,
  keyThings,
  sectorEffects,
  switchTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
};
