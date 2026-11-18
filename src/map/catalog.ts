import type { ThingKind } from "./types";

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
};

const thingKinds = Object.keys(thingCatalog) as ThingKind[];

export {
  ceilingTextures,
  floorTextures,
  thingCatalog,
  thingKinds,
  wallTextures,
};
