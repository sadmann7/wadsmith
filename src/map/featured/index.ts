import type { GameMap } from "../types";
import { firstLight } from "./first-light";
import { furnaceRing } from "./furnace-ring";
import { pumpStation } from "./pump-station";
import { slagChannel } from "./slag-channel";

type FeaturedMode = "single" | "coop" | "deathmatch";

type FeaturedMap = {
  id: string;
  title: string;
  slot: string;
  mode: FeaturedMode;
  players: { min: number; max: number };
  skill: "Easy" | "Medium" | "Hard";
  par: number;
  blurb: string;
  tags: string[];
  map: GameMap;
};

const featuredMaps: FeaturedMap[] = [
  {
    id: "first-light",
    title: "First Light",
    slot: "MAP01",
    mode: "single",
    players: { min: 1, max: 1 },
    skill: "Easy",
    par: 90,
    blurb:
      "A short first level: a courtyard, one door, one switch and a hidden room. A good map to open and pull apart.",
    tags: ["A door to open", "Exit switch", "Hidden room"],
    map: firstLight,
  },
  {
    id: "slag-channel",
    title: "Slag Channel",
    slot: "MAP02",
    mode: "single",
    players: { min: 1, max: 1 },
    skill: "Medium",
    par: 180,
    blurb:
      "Walkways run along a channel of acid. A switch in the control room raises a bridge, and the blue key opens the way out.",
    tags: ["Acid floor", "Bridge switch", "Blue key", "Secret"],
    map: slagChannel,
  },
  {
    id: "furnace-ring",
    title: "Furnace Ring",
    slot: "MAP03",
    mode: "coop",
    players: { min: 2, max: 4 },
    skill: "Medium",
    par: 240,
    blurb:
      "A ring of walkways around a lava pit. One player holds the switch while the others cross the bridge to the yellow key.",
    tags: ["Lava pit", "Bridge switch", "Yellow key"],
    map: furnaceRing,
  },
  {
    id: "pump-station",
    title: "Pump Station",
    slot: "MAP04",
    mode: "coop",
    players: { min: 2, max: 2 },
    skill: "Hard",
    par: 300,
    blurb:
      "Two wings, two switches. Each switch opens the far door of the pump room, so a pair splits up and meets in the middle.",
    tags: ["Split switches", "Red key"],
    map: pumpStation,
  },
];

export { featuredMaps, type FeaturedMap, type FeaturedMode };
